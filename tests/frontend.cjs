'use strict';

/*
 * Browser tests for the eSIM WebApp.  The real page, CSS and script are served
 * from ../esim; /sdk/e5.js and the app backend are replaced by a small in-page
 * mock so the tests exercise the actual frontend without hardware.
 *
 * Playwright is optional in the repository and is normally available from the
 * visual-test workspace on the build machine.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

function loadPlaywright() {
    const candidates = [];
    if (process.env.PLAYWRIGHT_MODULE)
        candidates.push(process.env.PLAYWRIGHT_MODULE);
    candidates.push('playwright-core', '/tmp/e5-esim-visual/node_modules/playwright-core');
    for (const candidate of candidates) {
        try { return require(candidate); } catch (error) { /* try the next location */ }
    }
    throw new Error('playwright-core is not installed (set PLAYWRIGHT_MODULE or install it with npm)');
}

function chromePath() {
    if (process.env.CHROME_BIN)
        return process.env.CHROME_BIN;
    const candidates = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser'
    ];
    const found = candidates.find((candidate) => fs.existsSync(candidate));
    if (!found)
        throw new Error('Chrome not found (set CHROME_BIN)');
    return found;
}

const { chromium } = loadPlaywright();
const root = path.join(__dirname, '..', 'esim');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const SDK = `
window.__calls = [];
window.__toasts = [];
window.__exited = false;
(function () {
 const e5 = {
  version: 2,
  id: 'esim',
  lang: 'zh',
  api(path, opts) {
   const call = { path, opts: opts || {} };
   window.__calls.push(call);
   const pathname = String(path).split('?')[0];
   return Promise.resolve().then(() => window.__mock(pathname, opts || {}, path));
  },
  onKey(fn) { window.__onKey = fn; },
  onBack(fn) { window.__onBack = fn; },
  onLang(fn) { window.__onLang = fn; },
  t(value) { return value && typeof value === 'object' ? (value[this.lang] ?? value.zh ?? value.en ?? '') : String(value ?? ''); },
  press(node) { node.click(); },
  toast(text) { window.__toasts.push(String(text)); },
  exit() { window.__exited = true; },
  keepAwake() {}
 };
 window.e5 = e5;
})();
`;

const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/sdk/e5.js') {
        response.writeHead(200, { 'Content-Type': types['.js'] });
        response.end(SDK);
        return;
    }
    const name = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
    if (!/^(index\.html|esim\.js|esim\.css)$/.test(name)) {
        response.writeHead(404);
        response.end('not found');
        return;
    }
    const file = path.join(root, name);
    if (!fs.existsSync(file)) {
        response.writeHead(404);
        response.end('not found');
        return;
    }
    response.writeHead(200, { 'Content-Type': types[path.extname(name)] || 'application/octet-stream' });
    response.end(fs.readFileSync(file));
});

const SE0 = 'A06573746B6D65FFFF4953442D522030';
const SE1 = 'A06573746B6D65FFFF4953442D522031';
const PROFILE_ON = { iccid: '8944476500021923789', profileName: 'Travel', serviceProviderName: 'BetterRoaming', profileState: 'enabled' };
const PROFILE_OFF = { iccid: '8944200204873015264', profileName: '3UK', profileNickname: '3UK 7400', serviceProviderName: '3UK', profileState: 'disabled' };

function chip(slot) {
    return {
        eidValue: '8904903200500888260005918164138' + slot,
        EUICCInfo2: {
            euiccFirmwareVer: '4.6.0',
            svn: '2.2.0',
            profileVersion: '2.1.0',
            globalplatformVersion: '2.3.0',
            extCardResource: { freeNonVolatileMemory: 280318, freeVolatileMemory: 5970 },
            euiccCiPKIdListForSigning: ['key-a', 'key-b'],
            euiccCiPKIdListForVerification: ['key-c'],
            sasAcreditationNumber: 'GI-BA-UP-0419'
        }
    };
}

function snapshot(params) {
    const aid = params.aid || SE0;
    return {
        ok: true,
        aid,
        ses: 3,
        chip: { ok: true, data: chip(params.slot) },
        profiles: { ok: true, data: params.slot === 0 ? [PROFILE_ON, PROFILE_OFF] : [PROFILE_ON] },
        notifications: { ok: true, data: params.slot === 0 ? [
            { seqNumber: 11, profileManagementOperation: 'install', iccid: '8944', notificationAddress: 'server.example' },
            { seqNumber: 12, profileManagementOperation: 'delete', iccid: '8945', notificationAddress: 'server.example' }
        ] : [] }
    };
}

const FIXTURES = `
window.SE0 = ${JSON.stringify(SE0)};
window.SE1 = ${JSON.stringify(SE1)};
window.PROFILE_ON = ${JSON.stringify(PROFILE_ON)};
window.PROFILE_OFF = ${JSON.stringify(PROFILE_OFF)};
window.chip = ${chip.toString()};
window.snapshot = ${snapshot.toString()};
`;

function mainScenario() {
    let job = { running: false };
    return async (pathname, opts) => {
        if (pathname === '/status')
            return { installed: true, installing: false, error: null };
        if (pathname === '/install')
            return { ok: true };
        if (pathname !== '/rpc')
            throw new Error('unexpected path ' + pathname);
        const method = opts.body && opts.body.method;
        const params = opts.body && opts.body.params || {};
        if (method === 'dependencies')
            return { ok: true, data: { ready: true, missing: [] } };
        if (method === 'snapshot')
            return snapshot(params);
        if (method === 'job_status')
            return job;
        if (method === 'notifications')
            return { ok: true, data: [
                { seqNumber: 11, profileManagementOperation: 'install', iccid: '8944', notificationAddress: 'server.example' },
                { seqNumber: 12, profileManagementOperation: 'delete', iccid: '8945', notificationAddress: 'server.example' }
            ] };
        if (method === 'operation_start') {
            const request = JSON.parse(params.request);
            if (request.action === 'notifications') {
                const done = !request.remove;
                job = { running: false, state: 'done', processed: request.notifications.length,
                    failed: false, data: done ? [{ seqNumber: 12, profileManagementOperation: 'delete', iccid: '8945', notificationAddress: 'server.example' }] : [] };
            } else if (request.action === 'delete') {
                job = { running: false, state: 'done', data: [PROFILE_ON] };
            } else {
                job = { running: false, state: 'done', data: request.action === 'switch'
                    ? [{ ...PROFILE_ON, profileState: request.enabled ? 'enabled' : 'disabled' }]
                    : [{ ...PROFILE_ON, profileNickname: request.name }] };
            }
            return { ok: true };
        }
        return { ok: true };
    };
}

function downloadScenario() {
    let stage = 0;
    let started = false;
    return async (pathname, opts) => {
        if (pathname === '/status')
            return { installed: true, installing: false, error: null };
        if (pathname !== '/rpc')
            return { ok: true };
        const method = opts.body && opts.body.method;
        const params = opts.body && opts.body.params || {};
        if (method === 'dependencies')
            return { ok: true, data: { ready: true, missing: [] } };
        if (method === 'snapshot')
            return snapshot(params);
        if (method === 'download_start') {
            started = true;
            return { ok: true };
        }
        if (method === 'job_confirm')
            return { ok: true };
        if (method === 'job_cancel')
            return { ok: true };
        if (method === 'job_status') {
            if (!started)
                return { running: false };
            stage++;
            if (stage === 1)
                return { running: true, type: 'download', slot: 0, aid: SE0, step: 'es9p_authenticate_client' };
            if (stage === 2)
                return { running: true, type: 'download', slot: 0, aid: SE0, preview: true,
                    metadata: { serviceProviderName: 'Carrier', profileName: 'Preview', iccid: '8944001', profileClass: 'prod' } };
            if (stage === 3 || stage === 4)
                return { running: true, type: 'download', slot: 0, aid: SE0, step: 'es10b_load_bound_profile_package',
                    write: { written: 6300, total: 10000, percent: 63 } };
            return { running: false, type: 'download', slot: 0, aid: SE0, state: 'failed', error: 'cancelled' };
        }
        return { ok: true };
    };
}

function rejectedStartReachedScenario() {
    let job = { running: false };
    return async (pathname, opts) => {
        if (pathname === '/status')
            return { installed: true, installing: false, error: null };
        if (pathname !== '/rpc')
            return { ok: true };
        const method = opts.body && opts.body.method;
        const params = opts.body && opts.body.params || {};
        if (method === 'dependencies')
            return { ok: true, data: { ready: true, missing: [] } };
        if (method === 'snapshot')
            return snapshot(params);
        if (method === 'download_start') {
            job = { running: true, type: 'download', slot: 0, aid: SE0, step: 'es9p_authenticate_client' };
            throw new Error('connection lost');
        }
        if (method === 'job_status')
            return job;
        if (method === 'job_cancel') {
            job = { running: false, type: 'download', slot: 0, aid: SE0, state: 'cancelled', error: 'cancelled' };
            return { ok: true };
        }
        return { ok: true };
    };
}

function rejectedStartNoTaskScenario() {
    return async (pathname, opts) => {
        if (pathname === '/status')
            return { installed: true, installing: false, error: null };
        if (pathname !== '/rpc')
            return { ok: true };
        const method = opts.body && opts.body.method;
        const params = opts.body && opts.body.params || {};
        if (method === 'dependencies')
            return { ok: true, data: { ready: true, missing: [] } };
        if (method === 'snapshot')
            return snapshot(params);
        if (method === 'download_start')
            throw new Error('download start failed');
        if (method === 'job_status')
            return { running: false };
        return { ok: true };
    };
}

function startUnknownScenario() {
    return async (pathname, opts) => {
        if (pathname === '/status')
            return { installed: true, installing: false, error: null };
        if (pathname !== '/rpc')
            return { ok: true };
        const method = opts.body && opts.body.method;
        const params = opts.body && opts.body.params || {};
        if (method === 'dependencies')
            return { ok: true, data: { ready: true, missing: [] } };
        if (method === 'snapshot')
            return snapshot(params);
        if (method === 'download_start')
            throw new Error('download start failed');
        if (method === 'job_status')
            throw new Error('status offline');
        return { ok: true };
    };
}

function cancelRetryScenario() {
    let started = false;
    let cancelCalls = 0;
    let job = { running: false };
    return async (pathname, opts) => {
        if (pathname === '/status')
            return { installed: true, installing: false, error: null };
        if (pathname !== '/rpc')
            return { ok: true };
        const method = opts.body && opts.body.method;
        const params = opts.body && opts.body.params || {};
        if (method === 'dependencies')
            return { ok: true, data: { ready: true, missing: [] } };
        if (method === 'snapshot')
            return snapshot(params);
        if (method === 'download_start') {
            started = true;
            job = { running: true, type: 'download', slot: 0, aid: SE0, step: 'es9p_authenticate_client' };
            return { ok: true };
        }
        if (method === 'job_status')
            return started ? job : { running: false };
        if (method === 'job_cancel') {
            cancelCalls++;
            if (cancelCalls === 1)
                return null;
            if (cancelCalls === 2)
                return { ok: false, error: 'busy' };
            job = { running: false, type: 'download', slot: 0, aid: SE0, state: 'cancelled', error: 'cancelled' };
            return { ok: true };
        }
        return { ok: true };
    };
}

function pollOutageScenario() {
    let started = false;
    let failures = 0;
    let outage = true;
    let job = { running: false };
    return async (pathname, opts) => {
        if (pathname === '/status')
            return { installed: true, installing: false, error: null };
        if (pathname !== '/rpc')
            return { ok: true };
        const method = opts.body && opts.body.method;
        const params = opts.body && opts.body.params || {};
        if (method === 'dependencies')
            return { ok: true, data: { ready: true, missing: [] } };
        if (method === 'snapshot')
            return snapshot(params);
        if (method === 'download_start') {
            started = true;
            job = { running: true, type: 'download', slot: 0, aid: SE0, step: 'es10b_load_bound_profile_package',
                write: { written: 4200, total: 10000, percent: 42 } };
            return { ok: true };
        }
        if (method === 'job_status') {
            if (!started)
                return { running: false };
            if (outage) {
                failures++;
                if (failures <= 3)
                    throw new Error('status offline');
                outage = false;
            }
            return job;
        }
        if (method === 'job_cancel') {
            job = { running: false, type: 'download', slot: 0, aid: SE0, state: 'cancelled', error: 'cancelled' };
            return { ok: true };
        }
        return { ok: true };
    };
}

function previewCancelScenario() {
    let started = false;
    let job = { running: false };
    return async (pathname, opts) => {
        if (pathname === '/status')
            return { installed: true, installing: false, error: null };
        if (pathname !== '/rpc')
            return { ok: true };
        const method = opts.body && opts.body.method;
        const params = opts.body && opts.body.params || {};
        if (method === 'dependencies')
            return { ok: true, data: { ready: true, missing: [] } };
        if (method === 'snapshot')
            return snapshot(params);
        if (method === 'download_start') {
            started = true;
            job = { running: true, type: 'download', slot: 0, aid: SE0, preview: true,
                metadata: { serviceProviderName: 'Carrier', profileName: 'Preview', iccid: '8944001' } };
            return { ok: true };
        }
        if (method === 'job_status')
            return started ? job : { running: false };
        if (method === 'job_confirm')
            return { ok: true };
        if (method === 'job_cancel') {
            job = { running: false, type: 'download', slot: 0, aid: SE0, state: 'cancelled', error: 'cancelled' };
            return { ok: true };
        }
        return { ok: true };
    };
}

function cancelActualSuccessScenario() {
    let started = false;
    let cancelling = false;
    let polls = 0;
    let job = { running: false };
    return async (pathname, opts) => {
        if (pathname === '/status')
            return { installed: true, installing: false, error: null };
        if (pathname !== '/rpc')
            return { ok: true };
        const method = opts.body && opts.body.method;
        const params = opts.body && opts.body.params || {};
        if (method === 'dependencies')
            return { ok: true, data: { ready: true, missing: [] } };
        if (method === 'snapshot')
            return snapshot(params);
        if (method === 'download_start') {
            started = true;
            job = { running: true, type: 'download', slot: 0, aid: SE0, step: 'es10b_load_bound_profile_package',
                write: { written: 8000, total: 10000, percent: 80 } };
            return { ok: true };
        }
        if (method === 'job_status') {
            if (!started)
                return { running: false };
            if (cancelling) {
                polls++;
                if (polls >= 2)
                    job = { running: false, type: 'download', slot: 0, aid: SE0, state: 'done', data: [PROFILE_ON] };
            }
            return job;
        }
        if (method === 'job_cancel') {
            cancelling = true;
            return { ok: true };
        }
        return { ok: true };
    };
}

function cancelDuringStartScenario() {
    let started = false;
    let job = { running: false };
    return async (pathname, opts) => {
        if (pathname === '/status')
            return { installed: true, installing: false, error: null };
        if (pathname !== '/rpc')
            return { ok: true };
        const method = opts.body && opts.body.method;
        const params = opts.body && opts.body.params || {};
        if (method === 'dependencies')
            return { ok: true, data: { ready: true, missing: [] } };
        if (method === 'snapshot')
            return snapshot(params);
        if (method === 'download_start') {
            started = true;
            job = { running: true, type: 'download', slot: 0, aid: SE0, step: 'es9p_authenticate_client' };
            await new Promise((resolve) => setTimeout(resolve, 800));
            return { ok: true };
        }
        if (method === 'job_status')
            return started ? job : { running: false };
        if (method === 'job_cancel') {
            job = { running: false, type: 'download', slot: 0, aid: SE0, state: 'cancelled', error: 'cancelled' };
            return { ok: true };
        }
        return { ok: true };
    };
}

function explicitBusyScenario() {
    let oldJob = { running: false };
    return async (pathname, opts) => {
        if (pathname === '/status')
            return { installed: true, installing: false, error: null };
        if (pathname !== '/rpc')
            return { ok: true };
        const method = opts.body && opts.body.method;
        const params = opts.body && opts.body.params || {};
        if (method === 'dependencies')
            return { ok: true, data: { ready: true, missing: [] } };
        if (method === 'snapshot')
            return snapshot(params);
        if (method === 'download_start') {
            oldJob = { running: true, type: 'download', slot: 0, aid: SE0, step: 'es10b_load_bound_profile_package' };
            return { ok: false, error: 'busy' };
        }
        if (method === 'job_status')
            return oldJob;
        if (method === 'job_cancel')
            return { ok: true };
        return { ok: true };
    };
}

function mismatchRunningScenario() {
    let started = false;
    return async (pathname, opts) => {
        if (pathname === '/status')
            return { installed: true, installing: false, error: null };
        if (pathname !== '/rpc')
            return { ok: true };
        const method = opts.body && opts.body.method;
        const params = opts.body && opts.body.params || {};
        if (method === 'dependencies')
            return { ok: true, data: { ready: true, missing: [] } };
        if (method === 'snapshot')
            return snapshot(params);
        if (method === 'download_start') {
            started = true;
            return { ok: true };
        }
        if (method === 'job_status') {
            if (!started)
                return { running: false };
            return { running: true, type: 'download', slot: 1, aid: SE0,
                metadata: { profileName: 'OtherTask' }, step: 'es9p_authenticate_client' };
        }
        if (method === 'job_cancel')
            return { ok: true };
        return { ok: true };
    };
}

function lateCancelFailureScenario() {
    let started = false;
    return async (pathname, opts) => {
        if (pathname === '/status')
            return { installed: true, installing: false, error: null };
        if (pathname !== '/rpc')
            return { ok: true };
        const method = opts.body && opts.body.method;
        const params = opts.body && opts.body.params || {};
        if (method === 'dependencies')
            return { ok: true, data: { ready: true, missing: [] } };
        if (method === 'snapshot')
            return snapshot(params);
        if (method === 'download_start') {
            started = true;
            return { ok: true };
        }
        if (method === 'job_status') {
            if (!started)
                return { running: false };
            return { running: false, type: 'download', slot: 0, aid: SE0, state: 'done', data: [PROFILE_ON] };
        }
        if (method === 'job_cancel')
            return new Promise((resolve, reject) => setTimeout(() => reject(new Error('late cancel failure')), 1500));
        return { ok: true };
    };
}

function resumeScenario() {
    let stage = 0;
    return async (pathname, opts) => {
        if (pathname === '/status')
            return { installed: true, installing: false, error: null };
        if (pathname !== '/rpc')
            return { ok: true };
        const method = opts.body && opts.body.method;
        const params = opts.body && opts.body.params || {};
        if (method === 'dependencies')
            return { ok: true, data: { ready: true, missing: [] } };
        if (method === 'snapshot')
            return snapshot(params);
        if (method === 'job_status') {
            stage++;
            if (stage === 1)
                return { running: true, type: 'operation', slot: 0, action: 'rename', aid: SE0 };
            return { running: false, state: 'done', data: [{ ...PROFILE_ON, profileNickname: 'Resumed' }] };
        }
        return { ok: true };
    };
}

function resumeDownloadScenario() {
    return async (pathname, opts) => {
        if (pathname === '/status')
            return { installed: true, installing: false, error: null };
        if (pathname !== '/rpc')
            return { ok: true };
        const method = opts.body && opts.body.method;
        const params = opts.body && opts.body.params || {};
        if (method === 'dependencies')
            return { ok: true, data: { ready: true, missing: [] } };
        if (method === 'snapshot')
            return snapshot(params);
        if (method === 'job_status')
            return { running: true, type: 'download', slot: 0, aid: SE0, state: 'running', step: 'es10b_load_bound_profile_package',
                write: { written: 6300, total: 10000, percent: 63 } };
        return { ok: true };
    };
}

function notificationFailureScenario() {
    let job = { running: false };
    return async (pathname, opts) => {
        if (pathname === '/status')
            return { installed: true, installing: false, error: null };
        if (pathname !== '/rpc')
            return { ok: true };
        const method = opts.body && opts.body.method;
        const params = opts.body && opts.body.params || {};
        if (method === 'dependencies')
            return { ok: true, data: { ready: true, missing: [] } };
        if (method === 'snapshot')
            return snapshot(params);
        if (method === 'notifications')
            return { ok: true, data: [{ seqNumber: 21, profileManagementOperation: 'install', iccid: '8944', notificationAddress: 'server.example' }] };
        if (method === 'job_status')
            return job;
        if (method === 'operation_start') {
            job = { running: false, state: 'failed', error: 'lpac', detail: 'timeout' };
            return { ok: true };
        }
        return { ok: true };
    };
}

function installScenario() {
    let installed = false;
    let installs = 0;
    return async (pathname, opts) => {
        if (pathname === '/status')
            return { installed, installing: false, error: installed ? null : 'download failed' };
        if (pathname === '/install') {
            installs++;
            installed = true;
            return { installed: true, installing: false, error: null };
        }
        if (pathname === '/rpc') {
            const method = opts.body.method;
            if (method === 'dependencies')
                return { ok: true, data: { ready: true, missing: [] } };
            if (method === 'job_status')
                return { running: false };
            if (method === 'snapshot')
                return snapshot(opts.body.params);
        }
        throw new Error('unexpected path ' + pathname);
    };
}

function pendingInstallScenario() {
    let stage = 0;
    return async (pathname, opts) => {
        if (pathname === '/status') {
            stage++;
            if (stage < 3)
                return { installed: true, installing: true, error: null };
            return { installed: true, installing: false, error: null };
        }
        if (pathname === '/rpc') {
            const method = opts.body.method;
            if (method === 'dependencies')
                return { ok: true, data: { ready: true, missing: [] } };
            if (method === 'job_status')
                return { running: false };
            if (method === 'snapshot')
                return snapshot(opts.body.params);
        }
        return { ok: true };
    };
}

function dependencyScenario() {
    let installed = false;
    let installing = false;
    return async (pathname, opts) => {
        if (pathname === '/status')
            return { installed: true, installing, error: null };
        if (pathname === '/install') {
            installing = true;
            setTimeout(() => { installed = true; installing = false; }, 1300);
            return { installed: true, installing: true, error: null };
        }
        if (pathname === '/rpc') {
            const method = opts.body.method;
            if (method === 'dependencies')
                return installed
                    ? { ok: true, data: { ready: true, missing: [] } }
                    : { ok: true, data: { ready: false, missing: ['lpac'] } };
            if (method === 'job_status')
                return { running: false };
            if (method === 'snapshot')
                return snapshot(opts.body.params);
        }
        return { ok: true };
    };
}

function idleInstallScenario() {
    return async (pathname, opts) => {
        if (pathname === '/status')
            return { installed: false, installing: false, error: null };
        if (pathname === '/install')
            return { installed: true, installing: false, error: null };
        if (pathname === '/rpc') {
            const method = opts.body.method;
            if (method === 'dependencies')
                return { ok: true, data: { ready: true, missing: [] } };
            if (method === 'job_status')
                return { running: false };
            if (method === 'snapshot')
                return snapshot(opts.body.params);
        }
        return { ok: true };
    };
}

function postMissingScenario() {
    return async (pathname) => {
        if (pathname === '/status')
            return { installed: false, installing: false, error: null };
        if (pathname === '/install')
            return { installed: false, installing: false, error: 'install failed' };
        return { ok: true };
    };
}

function liveLogScenario() {
    let stage = 0;
    const escape = String.fromCharCode(27);
    const url = 'https://example.com/' + 'very-long-token-'.repeat(10);
    const lines = (count) => Array.from({ length: count }, (_, index) => `line ${index + 1} ${url}`).join('\n');
    return async (pathname, opts) => {
        if (pathname === '/status') {
            stage++;
            if (stage === 1)
                return { installed: false, installing: true, error: null,
                    log: 'start\n<b>not-html</b>\n' + escape + '[31mred' + escape + '[0m\rprogress 10%\rprogress 20%\n' + lines(20) };
            if (stage === 2)
                return { installed: false, installing: true, error: null,
                    log: 'start\nred\nprogress 10%\nprogress 20%\n' + lines(25) };
            if (stage === 3)
                return { installed: false, installing: true, error: null,
                    log: 'start\nred\nprogress 10%\nprogress 20%\n' + lines(30) };
            return { installed: true, installing: false, error: null,
                log: 'done\n' + lines(31) };
        }
        if (pathname === '/rpc') {
            const method = opts.body.method;
            if (method === 'dependencies')
                return { ok: true, data: { ready: true, missing: [] } };
            if (method === 'job_status')
                return { running: false };
            if (method === 'snapshot')
                return snapshot(opts.body.params);
        }
        return { ok: true };
    };
}

function failureLogScenario() {
    let stage = 0;
    const url = 'https://example.com/' + 'very-long-token-'.repeat(10);
    return async (pathname) => {
        if (pathname === '/status') {
            stage++;
            if (stage === 1)
                return { installed: false, installing: true, error: null,
                    log: 'start\ninstalling package\n' };
            return { installed: false, installing: false, error: 'Installation failed',
                log: 'start\ninstalling package\nFAILED: missing dependency\n' + url };
        }
        return { ok: true };
    };
}

function pollErrorScenario() {
    let stage = 0;
    return async (pathname) => {
        if (pathname === '/status') {
            stage++;
            if (stage === 1)
                return { installed: false, installing: true, error: null };
            throw new Error('network down');
        }
        return { ok: true };
    };
}

async function waitView(page, view) {
    await page.waitForFunction((name) => document.getElementById('app').dataset.view === name, view, { timeout: 15000 });
}

async function open(browser, base, scenarioFactory) {
    const page = await browser.newPage({ viewport: { width: 320, height: 480 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(FIXTURES);
    await page.addInitScript(`window.__mock = (${scenarioFactory.toString()})();`);
    await page.goto(base + '/', { waitUntil: 'load' });
    page.errors = errors;
    return page;
}

function statusPaths(page) {
    return page.evaluate(() => window.__calls
        .map((call) => call.path)
        .filter((name) => name === '/status' || name === '/status?check=1'));
}

function rpcCalls(page, method) {
    return page.evaluate((name) => window.__calls
        .filter((call) => call.path === '/rpc' && call.opts.body && call.opts.body.method === name)
        .map((call) => call.opts.body.params || {}), method);
}

async function noOverflow(page) {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        'horizontal overflow at ' + await page.evaluate(() => innerWidth) + 'px');
}

(async () => {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
    try {
        // Install gate: failure is visible, retry is explicit, success enters the app.
        {
            const page = await open(browser, base, installScenario);
            await waitView(page, 'install');
            assert.ok((await page.locator('#app').textContent()).includes('组件安装失败'));
            assert.ok(await page.getByRole('button', { name: '重试安装' }).isVisible());
            await page.waitForTimeout(1200);
            assert.deepEqual(await statusPaths(page), ['/status?check=1']);
            assert.equal(await page.locator('#app').getAttribute('data-view'), 'install');
            await page.getByRole('button', { name: '重试安装' }).click();
            await waitView(page, 'root');
            assert.equal(await page.evaluate(() => window.__calls.filter((call) => call.path === '/install').length), 1);
            await page.waitForTimeout(1200);
            assert.deepEqual(await statusPaths(page), ['/status?check=1']);
            assert.deepEqual(page.errors, []);
            await page.close();
        }

        // A pending install is polled without user input.
        {
            const page = await open(browser, base, pendingInstallScenario);
            await waitView(page, 'install');
            assert.ok((await page.locator('#app').textContent()).includes('正在安装'));
            await waitView(page, 'root');
            assert.ok(await page.getByRole('tab', { name: 'SIM 2' }).isVisible());
            const pendingStatus = await statusPaths(page);
            assert.deepEqual(pendingStatus, ['/status?check=1', '/status', '/status']);
            await page.waitForTimeout(1200);
            assert.deepEqual(await statusPaths(page), pendingStatus);
            assert.deepEqual(page.errors, []);
            await page.close();
        }

        // Missing runtime dependencies are shown with an explicit install button.
        {
            const page = await open(browser, base, dependencyScenario);
            await waitView(page, 'deps');
            assert.ok((await page.locator('#app').textContent()).includes('lpac'));
            assert.deepEqual(await statusPaths(page), ['/status?check=1']);
            await page.getByRole('button', { name: '安装组件' }).click();
            await page.waitForTimeout(300);
            assert.equal(await page.locator('#app').getAttribute('data-view'), 'install');
            await waitView(page, 'root');
            assert.equal(await page.evaluate(() => window.__calls.filter((call) => call.path === '/install').length), 1);
            const dependencyStatus = await statusPaths(page);
            assert.deepEqual(dependencyStatus, ['/status?check=1', '/status', '/status']);
            await page.waitForTimeout(1200);
            assert.deepEqual(await statusPaths(page), dependencyStatus);
            await page.close();
        }

        // Idle missing install stays on the Install screen without polling.
        {
            const page = await open(browser, base, idleInstallScenario);
            await waitView(page, 'install');
            assert.ok(await page.getByRole('button', { name: '安装', exact: true }).isVisible());
            await page.waitForTimeout(1200);
            assert.deepEqual(await statusPaths(page), ['/status?check=1']);
            await page.getByRole('button', { name: '安装', exact: true }).click();
            await waitView(page, 'root');
            await page.waitForTimeout(1200);
            assert.deepEqual(await statusPaths(page), ['/status?check=1']);
            assert.deepEqual(page.errors, []);
            await page.close();
        }

        // A POST response that is still missing is applied immediately and does not poll.
        {
            const page = await open(browser, base, postMissingScenario);
            await waitView(page, 'install');
            await page.getByRole('button', { name: '安装', exact: true }).click();
            await waitView(page, 'install');
            await page.waitForFunction(() => document.getElementById('app').textContent.includes('install failed'), null, { timeout: 5000 });
            assert.ok(await page.getByRole('button', { name: '重试安装' }).isVisible());
            await page.waitForTimeout(1200);
            assert.deepEqual(await statusPaths(page), ['/status?check=1']);
            assert.deepEqual(page.errors, []);
            await page.close();
        }

        // A failing status poll shows the error once and stops.
        {
            const page = await open(browser, base, pollErrorScenario);
            await waitView(page, 'install');
            await page.waitForFunction(() => document.getElementById('app').textContent.includes('network down'), null, { timeout: 5000 });
            assert.deepEqual(await statusPaths(page), ['/status?check=1', '/status']);
            assert.ok(await page.getByRole('button', { name: '重试安装' }).isVisible());
            await page.waitForTimeout(1200);
            assert.deepEqual(await statusPaths(page), ['/status?check=1', '/status']);
            assert.equal(await page.locator('#app').getAttribute('data-view'), 'install');
            assert.deepEqual(page.errors, []);
            await page.close();
        }

        // Live install log follows the tail, preserves manual history and stops on success.
        {
            const page = await open(browser, base, liveLogScenario);
            await waitView(page, 'install');
            await page.setViewportSize({ width: 320, height: 345 });
            const firstLog = await page.locator('#install-log').textContent();
            assert.ok(firstLog.includes('red'));
            assert.ok(firstLog.includes('progress 10%\nprogress 20%'));
            assert.equal(firstLog.includes('\u001b'), false);
            assert.equal(firstLog.includes('\r'), false);
            assert.ok(firstLog.includes('<b>not-html</b>'));
            assert.equal(await page.locator('#install-log b').count(), 0);
            assert.ok(firstLog.split('\n').length >= 20);
            assert.ok(await page.evaluate(() => {
                const log = document.getElementById('install-log');
                return log.scrollWidth <= log.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth &&
                    document.querySelector('[data-focus="install"]').getBoundingClientRect().bottom <= window.innerHeight;
            }));
            await page.evaluate(() => window.__onKey({ kind: 'up' }));
            assert.equal(await page.evaluate(() => document.activeElement.id), 'install-log');
            const logBefore = await page.evaluate(() => document.getElementById('install-log').scrollTop);
            await page.evaluate(() => window.__onKey({ kind: 'up' }));
            assert.ok(await page.evaluate((before) => document.getElementById('install-log').scrollTop < before, logBefore));
            assert.equal(await page.evaluate(() => document.activeElement.id), 'install-log');
            await page.evaluate(() => {
                const log = document.getElementById('install-log');
                log.scrollTop = log.scrollHeight;
                log.dispatchEvent(new Event('scroll'));
            });
            await page.evaluate(() => window.__onKey({ kind: 'down' }));
            assert.equal(await page.evaluate(() => document.activeElement.dataset.focus), 'install');
            await page.evaluate(() => {
                const log = document.getElementById('install-log');
                log.scrollTop = 0;
                log.dispatchEvent(new Event('scroll'));
            });
            await page.waitForFunction(() => document.getElementById('install-log').textContent.includes('line 25'), null, { timeout: 15000 });
            assert.ok(await page.evaluate(() => document.getElementById('install-log').scrollTop <= 1));
            assert.equal(await page.evaluate(() => document.activeElement.dataset.focus), 'install');
            await page.evaluate(() => {
                const log = document.getElementById('install-log');
                log.scrollTop = log.scrollHeight;
                log.dispatchEvent(new Event('scroll'));
            });
            await page.waitForFunction(() => document.getElementById('install-log').textContent.includes('line 30'), null, { timeout: 15000 });
            assert.ok(await page.evaluate(() => {
                const log = document.getElementById('install-log');
                return log.scrollHeight - log.scrollTop - log.clientHeight <= 8;
            }));
            await waitView(page, 'root');
            await page.waitForTimeout(1200);
            assert.deepEqual(await statusPaths(page), ['/status?check=1', '/status', '/status', '/status']);
            assert.equal(await page.locator('#install-log').count(), 0);
            assert.deepEqual(page.errors, []);
            await page.close();
        }

        // Terminal failure keeps the concise error and the log panel, then stops polling.
        {
            const page = await open(browser, base, failureLogScenario);
            await waitView(page, 'install');
            await page.setViewportSize({ width: 320, height: 345 });
            await page.waitForFunction(() => document.getElementById('install-log').textContent.includes('FAILED: missing dependency'), null, { timeout: 15000 });
            const hintText = await page.locator('#app .state-hint').textContent();
            assert.ok(hintText.includes('Installation failed'));
            assert.ok(hintText.includes('重试'));
            assert.equal((await page.locator('#app').textContent()).split('Installation failed').length - 1, 1);
            const logText = await page.locator('#install-log').textContent();
            assert.ok(logText.includes('FAILED: missing dependency'));
            assert.ok(await page.getByRole('button', { name: '重试安装' }).isVisible());
            assert.ok(await page.evaluate(() => {
                const retry = document.querySelector('[data-focus="install"]').getBoundingClientRect();
                return document.documentElement.scrollWidth <= window.innerWidth && retry.bottom <= window.innerHeight;
            }));
            await page.waitForTimeout(1200);
            assert.deepEqual(await statusPaths(page), ['/status?check=1', '/status']);
            assert.ok((await page.locator('#install-log').textContent()).includes('FAILED: missing dependency'));
            assert.deepEqual(page.errors, []);
            await page.close();
        }

        // Main flows: both slots, persisted scan/SE, profile actions, notifications.
        {
            const page = await open(browser, base, mainScenario);
            await waitView(page, 'root');
            await page.setViewportSize({ width: 320, height: 345 });
            await noOverflow(page);
            assert.equal(await page.locator('.topbar').isVisible(), false);
            assert.equal(await page.locator('#app').getAttribute('data-view'), 'root');
            await page.setViewportSize({ width: 320, height: 480 });
            assert.equal(await page.getByRole('tab', { name: 'SIM 1' }).isVisible(), true);
            assert.equal(await page.getByRole('tab', { name: 'SIM 2' }).isVisible(), true);
            assert.equal(await page.getByRole('button', { name: 'SE 0' }).isVisible(), true);
            assert.equal(await page.getByRole('button', { name: 'SE 1' }).isVisible(), true);
            assert.deepEqual((await rpcCalls(page, 'snapshot'))[0], { slot: 0, aid: '', scan: true });
            assert.equal((await rpcCalls(page, 'operation_start')).length, 0, 'polling must not start an operation');
            assert.equal((await rpcCalls(page, 'download_start')).length, 0);
            assert.ok((await page.locator('#app').textContent()).includes('Travel'));

            await page.getByRole('tab', { name: 'SIM 2' }).click();
            await waitView(page, 'root');
            let snaps = await rpcCalls(page, 'snapshot');
            assert.deepEqual(snaps.at(-1), { slot: 1, aid: '', scan: true });
            assert.ok((await page.locator('#app').textContent()).includes('Travel'));

            await page.getByRole('tab', { name: 'SIM 1' }).click();
            await waitView(page, 'root');
            snaps = await rpcCalls(page, 'snapshot');
            assert.deepEqual(snaps.at(-1), { slot: 0, aid: SE0, scan: false });

            await page.getByRole('button', { name: 'SE 1' }).click();
            await waitView(page, 'root');
            snaps = await rpcCalls(page, 'snapshot');
            assert.deepEqual(snaps.at(-1), { slot: 0, aid: SE1, scan: false });

            // Profile details, explicit delete confirmation, operation_start JSON.
            await page.getByRole('button', { name: '3UK 7400' }).click();
            await waitView(page, 'profile');
            assert.ok((await page.locator('#app').textContent()).includes('8944200204873015264'));
            await page.getByRole('button', { name: '删除' }).click();
            await waitView(page, 'confirm');
            assert.equal((await rpcCalls(page, 'operation_start')).length, 0);
            await page.getByRole('button', { name: '删除', exact: true }).click();
            await waitView(page, 'root');
            const operation = (await rpcCalls(page, 'operation_start')).at(-1);
            assert.equal(operation.slot, 0);
            assert.equal(operation.aid, SE1);
            assert.equal(JSON.parse(operation.request).action, 'delete');
            assert.equal(JSON.parse(operation.request).iccid, PROFILE_OFF.iccid);

            // Rename uses the value typed into the real input.
            await page.getByRole('button', { name: 'Travel' }).click();
            await waitView(page, 'profile');
            await page.getByRole('button', { name: '重命名' }).click();
            await waitView(page, 'rename');
            await page.evaluate(() => window.__onBack());
            await waitView(page, 'profile');
            await page.getByRole('button', { name: '重命名' }).click();
            await waitView(page, 'rename');
            await page.locator('#esim-name').fill('Travel Renamed');
            await page.getByRole('button', { name: '保存' }).click();
            await waitView(page, 'root');
            const rename = (await rpcCalls(page, 'operation_start')).at(-1);
            assert.equal(JSON.parse(rename.request).action, 'rename');
            assert.equal(JSON.parse(rename.request).name, 'Travel Renamed');

            // Notifications: single processing and confirmed bulk delete.
            await page.getByRole('button', { name: '通知 (2)' }).click();
            await waitView(page, 'notifications');
            await page.getByRole('button', { name: '通知 11' }).click();
            await waitView(page, 'notification');
            await page.getByRole('button', { name: '处理', exact: true }).click();
            await waitView(page, 'notifications');
            let notif = (await rpcCalls(page, 'operation_start')).at(-1);
            assert.equal(JSON.parse(notif.request).action, 'notifications');
            assert.equal(JSON.parse(notif.request).remove, false);
            assert.equal(JSON.parse(notif.request).notifications[0].seqNumber, 11);
            await page.getByRole('button', { name: '全部删除' }).click();
            await waitView(page, 'confirm');
            assert.equal((await rpcCalls(page, 'operation_start')).length, 3);
            await page.getByRole('button', { name: '删除', exact: true }).click();
            await waitView(page, 'notifications');
            notif = (await rpcCalls(page, 'operation_start')).at(-1);
            assert.equal(JSON.parse(notif.request).remove, true);

            // Keypad navigation and language switch keep the current root view.
            await page.getByRole('button', { name: '返回' }).click();
            await waitView(page, 'root');
            await page.keyboard.press('ArrowDown');
            const focused = await page.evaluate(() => document.activeElement && document.activeElement.dataset.focus);
            assert.ok(focused, 'keypad focus moved to a control');
            await page.evaluate(() => { e5.lang = 'en'; window.__onLang(); });
            assert.ok((await page.locator('#screen-title').textContent()).includes('eSIM management'));
            assert.ok(await page.getByRole('button', { name: 'Add' }).isVisible());
            assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
            await noOverflow(page);
            assert.deepEqual(page.errors, []);
            await page.close();
        }

        // A failed notification operation returns to the refreshed list, not a stuck wait.
        {
            const page = await open(browser, base, notificationFailureScenario);
            await waitView(page, 'root');
            await page.getByRole('button', { name: '通知 (2)' }).click();
            await waitView(page, 'notifications');
            await page.getByRole('button', { name: '通知 21' }).click();
            await waitView(page, 'notification');
            await page.getByRole('button', { name: '处理', exact: true }).click();
            await waitView(page, 'notifications');
            assert.equal((await rpcCalls(page, 'operation_start')).length, 1);
            assert.ok((await page.locator('#app').textContent()).includes('通知'));
            assert.deepEqual(page.errors, []);
            await page.close();
        }

        // Download preview, progress, confirmation and cancellation.
        {
            const page = await open(browser, base, downloadScenario);
            await waitView(page, 'root');
            await page.getByRole('button', { name: '添加' }).click();
            await waitView(page, 'download');
            assert.equal(await page.getByRole('tab', { name: 'SIM 2' }).isVisible(), false);
            await page.evaluate(() => document.getElementById('sim-tab-1').click());
            await waitView(page, 'download');
            await page.locator('#esim-activation').fill('LPA:1$server$code');
            await page.locator('#esim-confirmation').fill('123');
            await page.getByRole('button', { name: '下载', exact: true }).click();
            await page.waitForFunction(() => document.getElementById('app').dataset.view === 'download_preview', null, { timeout: 15000 });
            assert.ok((await page.locator('#app').textContent()).includes('Preview'));
            const start = (await rpcCalls(page, 'download_start')).at(-1);
            assert.equal(start.activation, 'LPA:1$server$code');
            assert.equal(start.confirmation, '123');
            assert.equal(start.aid, SE0);
            await page.getByRole('button', { name: '确认下载' }).click();
            await page.waitForFunction(() => document.getElementById('app').textContent.includes('63%'), null, { timeout: 15000 });
            assert.equal(await page.locator('[role=progressbar]').getAttribute('aria-valuenow'), '63');
            assert.ok((await page.locator('#app').textContent()).includes('6.2 KB / 9.8 KB'));
            await page.getByRole('button', { name: '取消下载' }).click();
            await waitView(page, 'download');
            assert.equal(await page.evaluate(() => window.__calls.filter((call) => call.path === '/rpc' && call.opts.body.method === 'job_confirm').length), 1);
            assert.equal(await page.evaluate(() => window.__calls.filter((call) => call.path === '/rpc' && call.opts.body.method === 'job_cancel').length), 1);
            assert.ok((await page.locator('#app').textContent()).includes('激活码'));
            assert.equal((await rpcCalls(page, 'download_start')).length, 1);
            await noOverflow(page);
            assert.deepEqual(page.errors, []);
            await page.close();
        }

        // A rejected download_start whose request did reach the backend resumes the active task.
        {
            const page = await open(browser, base, rejectedStartReachedScenario);
            await waitView(page, 'root');
            await page.getByRole('button', { name: '添加' }).click();
            await waitView(page, 'download');
            await page.locator('#esim-activation').fill('LPA:1$server$code');
            await page.getByRole('button', { name: '下载', exact: true }).click();
            await waitView(page, 'download_progress');
            await page.waitForTimeout(1200);
            assert.equal(await page.locator('#app').getAttribute('data-view'), 'download_progress');
            assert.equal((await rpcCalls(page, 'download_start')).length, 1);
            assert.equal((await rpcCalls(page, 'job_confirm')).length, 0);
            assert.deepEqual(page.errors, []);
            await page.close();
        }

        // A rejected start with no matching active task returns to the form with an error.
        {
            const page = await open(browser, base, rejectedStartNoTaskScenario);
            await waitView(page, 'root');
            await page.getByRole('button', { name: '添加' }).click();
            await waitView(page, 'download');
            await page.locator('#esim-activation').fill('LPA:1$server$code');
            await page.getByRole('button', { name: '下载', exact: true }).click();
            await waitView(page, 'download');
            assert.ok((await page.evaluate(() => window.__toasts)).includes('操作失败，请重试'));
            assert.equal((await rpcCalls(page, 'download_start')).length, 1);
            assert.equal(await page.getByRole('button', { name: '下载', exact: true }).isVisible(), true);
            assert.deepEqual(page.errors, []);
            await page.close();
        }

        // An unknown start with unavailable status shows recoverable status controls.
        {
            const page = await open(browser, base, startUnknownScenario);
            await waitView(page, 'root');
            await page.getByRole('button', { name: '添加' }).click();
            await waitView(page, 'download');
            await page.locator('#esim-activation').fill('LPA:1$server$code');
            await page.getByRole('button', { name: '下载', exact: true }).click();
            await waitView(page, 'download_recover');
            assert.ok(await page.getByRole('button', { name: '检查状态' }).isVisible());
            assert.ok(await page.getByRole('button', { name: '取消下载' }).isVisible());
            await page.getByRole('button', { name: '检查状态' }).click();
            await page.waitForFunction(() => document.getElementById('app').textContent.includes('仍无法获取下载任务状态'), null, { timeout: 5000 });
            assert.ok(await page.getByRole('button', { name: '检查状态' }).isEnabled());
            assert.equal((await rpcCalls(page, 'download_start')).length, 1);
            assert.deepEqual(page.errors, []);
            await page.close();
        }

        // A failed job_cancel surfaces feedback and the retry remains enabled.
        {
            const page = await open(browser, base, cancelRetryScenario);
            await waitView(page, 'root');
            await page.getByRole('button', { name: '添加' }).click();
            await waitView(page, 'download');
            await page.locator('#esim-activation').fill('LPA:1$server$code');
            await page.getByRole('button', { name: '下载', exact: true }).click();
            await waitView(page, 'download_progress');
            await page.getByRole('button', { name: '取消下载', exact: true }).click();
            await waitView(page, 'download_recover');
            assert.ok((await page.locator('#app').textContent()).includes('取消请求失败'));
            assert.ok((await page.locator('#app').textContent()).includes('取消下载返回异常'));
            assert.ok(await page.getByRole('button', { name: '取消下载' }).isEnabled());
            await page.getByRole('button', { name: '取消下载' }).click();
            await page.waitForFunction(() => document.getElementById('app').textContent.includes('eSIM 正忙'));
            await page.getByRole('button', { name: '取消下载' }).click();
            await waitView(page, 'download');
            assert.equal((await rpcCalls(page, 'job_cancel')).length, 3);
            assert.equal((await rpcCalls(page, 'download_start')).length, 1);
            assert.ok((await page.evaluate(() => window.__toasts)).includes('已取消下载'));
            assert.deepEqual(page.errors, []);
            await page.close();
        }

        // Cancelling while download_start is pending defers job_cancel until the task exists.
        {
            const page = await open(browser, base, cancelDuringStartScenario);
            await waitView(page, 'root');
            await page.getByRole('button', { name: '添加' }).click();
            await waitView(page, 'download');
            await page.locator('#esim-activation').fill('LPA:1$server$code');
            await page.getByRole('button', { name: '下载', exact: true }).click();
            await waitView(page, 'download_progress');
            await page.getByRole('button', { name: '取消下载' }).click();
            await waitView(page, 'download_wait');
            await page.waitForTimeout(300);
            assert.equal((await rpcCalls(page, 'job_cancel')).length, 0);
            await waitView(page, 'download');
            assert.equal((await rpcCalls(page, 'job_cancel')).length, 1);
            assert.equal((await rpcCalls(page, 'download_start')).length, 1);
            assert.ok((await page.evaluate(() => window.__toasts)).includes('已取消下载'));
            assert.deepEqual(page.errors, []);
            await page.close();
        }

        // An explicit {ok:false} start failure is final and does not adopt an existing task.
        {
            const page = await open(browser, base, explicitBusyScenario);
            await waitView(page, 'root');
            const before = (await rpcCalls(page, 'job_status')).length;
            await page.getByRole('button', { name: '添加' }).click();
            await waitView(page, 'download');
            await page.locator('#esim-activation').fill('LPA:1$server$code');
            await page.getByRole('button', { name: '下载', exact: true }).click();
            await waitView(page, 'download');
            assert.equal((await rpcCalls(page, 'job_status')).length, before);
            assert.equal((await rpcCalls(page, 'download_start')).length, 1);
            assert.equal((await rpcCalls(page, 'job_cancel')).length, 0);
            assert.ok((await page.evaluate(() => window.__toasts)).includes('eSIM 正忙，请稍后再试'));
            assert.deepEqual(page.errors, []);
            await page.close();
        }

        // A running task for another slot is not adopted, previewed or cancelled.
        {
            const page = await open(browser, base, mismatchRunningScenario);
            await waitView(page, 'root');
            await page.getByRole('button', { name: '添加' }).click();
            await waitView(page, 'download');
            await page.locator('#esim-activation').fill('LPA:1$server$code');
            await page.getByRole('button', { name: '下载', exact: true }).click();
            await waitView(page, 'download_recover');
            assert.ok((await page.locator('#app').textContent()).includes('检测到其他下载任务'));
            assert.equal((await page.locator('#app').textContent()).includes('OtherTask'), false);
            await page.getByRole('button', { name: '取消下载' }).click();
            await waitView(page, 'download_recover');
            await page.waitForTimeout(300);
            assert.equal((await rpcCalls(page, 'job_cancel')).length, 0);
            assert.ok((await page.locator('#app').textContent()).includes('检测到其他下载任务'));
            assert.equal((await rpcCalls(page, 'download_start')).length, 1);
            assert.deepEqual(page.errors, []);
            await page.close();
        }

        // A late cancel failure after the task has already succeeded is ignored.
        {
            const page = await open(browser, base, lateCancelFailureScenario);
            await waitView(page, 'root');
            await page.getByRole('button', { name: '添加' }).click();
            await waitView(page, 'download');
            await page.locator('#esim-activation').fill('LPA:1$server$code');
            await page.getByRole('button', { name: '下载', exact: true }).click();
            await waitView(page, 'download_progress');
            await page.getByRole('button', { name: '取消下载' }).click();
            await waitView(page, 'root');
            await page.waitForTimeout(1000);
            assert.equal(await page.locator('#app').getAttribute('data-view'), 'root');
            assert.equal((await page.locator('#app').textContent()).includes('取消请求失败'), false);
            const toasts = await page.evaluate(() => window.__toasts);
            assert.ok(toasts.includes('配置文件已下载'));
            assert.equal(toasts.includes('已取消下载'), false);
            assert.equal((await rpcCalls(page, 'job_cancel')).length, 1);
            assert.equal((await rpcCalls(page, 'download_start')).length, 1);
            assert.deepEqual(page.errors, []);
            await page.close();
        }

        // Three status failures stop polling; Check status recovers the active task.
        {
            const page = await open(browser, base, pollOutageScenario);
            await waitView(page, 'root');
            await page.getByRole('button', { name: '添加' }).click();
            await waitView(page, 'download');
            await page.locator('#esim-activation').fill('LPA:1$server$code');
            await page.getByRole('button', { name: '下载', exact: true }).click();
            await waitView(page, 'download_progress');
            await waitView(page, 'download_recover');
            assert.ok((await page.locator('#app').textContent()).includes('连续三次无法获取下载任务状态'));
            const failedPolls = await rpcCalls(page, 'job_status');
            await page.getByRole('button', { name: '检查状态' }).click();
            await waitView(page, 'download_progress');
            await page.waitForFunction(() => document.getElementById('app').textContent.includes('42%'), null, { timeout: 5000 });
            await page.getByRole('button', { name: '取消下载' }).click();
            await waitView(page, 'download');
            assert.equal((await rpcCalls(page, 'download_start')).length, 1);
            assert.ok((await rpcCalls(page, 'job_status')).length > failedPolls.length);
            assert.deepEqual(page.errors, []);
            await page.close();
        }

        // Cancelling from the preview does not confirm the download.
        {
            const page = await open(browser, base, previewCancelScenario);
            await waitView(page, 'root');
            await page.getByRole('button', { name: '添加' }).click();
            await waitView(page, 'download');
            await page.locator('#esim-activation').fill('LPA:1$server$code');
            await page.getByRole('button', { name: '下载', exact: true }).click();
            await waitView(page, 'download_preview');
            await page.getByRole('button', { name: '取消', exact: true }).click();
            await waitView(page, 'download');
            assert.equal((await rpcCalls(page, 'job_confirm')).length, 0);
            assert.equal((await rpcCalls(page, 'job_cancel')).length, 1);
            assert.equal((await rpcCalls(page, 'download_start')).length, 1);
            assert.ok((await page.evaluate(() => window.__toasts)).includes('已取消下载'));
            assert.deepEqual(page.errors, []);
            await page.close();
        }

        // A cancel request racing a completed task reports the real success, not cancellation.
        {
            const page = await open(browser, base, cancelActualSuccessScenario);
            await waitView(page, 'root');
            await page.getByRole('button', { name: '添加' }).click();
            await waitView(page, 'download');
            await page.locator('#esim-activation').fill('LPA:1$server$code');
            await page.getByRole('button', { name: '下载', exact: true }).click();
            await waitView(page, 'download_progress');
            await page.getByRole('button', { name: '取消下载' }).click();
            await waitView(page, 'root');
            const toasts = await page.evaluate(() => window.__toasts);
            assert.ok(toasts.includes('配置文件已下载'));
            assert.equal(toasts.includes('已取消下载'), false);
            assert.equal((await rpcCalls(page, 'download_start')).length, 1);
            assert.equal((await rpcCalls(page, 'job_cancel')).length, 1);
            assert.deepEqual(page.errors, []);
            await page.close();
        }

        // An existing download is resumed at its current write progress.
        {
            const page = await open(browser, base, resumeDownloadScenario);
            await waitView(page, 'download_progress');
            await page.waitForFunction(() => document.getElementById('app').textContent.includes('63%'), null, { timeout: 15000 });
            assert.equal((await rpcCalls(page, 'download_start')).length, 0);
            assert.equal((await rpcCalls(page, 'job_confirm')).length, 0);
            assert.deepEqual(page.errors, []);
            await page.close();
        }

        // An existing background operation is resumed, not started again.
        {
            const page = await open(browser, base, resumeScenario);
            await waitView(page, 'wait');
            assert.ok((await page.locator('#app').textContent()).includes('正在重命名'));
            await waitView(page, 'root');
            assert.equal((await rpcCalls(page, 'operation_start')).length, 0);
            assert.ok((await rpcCalls(page, 'snapshot')).length >= 1);
            assert.ok((await page.locator('#app').textContent()).includes('Travel'));
            assert.deepEqual(page.errors, []);
            await page.close();
        }

        console.log('Frontend tests passed: install poll/log/retry, dependencies, both slots, persisted SE scan, profile operations, notifications, download preview/progress/cancel, resumed job, key focus and language.');
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
