'use strict';
import { readfile } from 'fs';

const DIR = '/etc/e5-infoscreen/plugins/esim';
const RUN = '/tmp/e5-webapp-esim';
const METHODS = [ 'snapshot', 'profiles', 'notifications', 'download_start',
 'operation_start', 'job_status', 'job_confirm', 'job_cancel', 'dependencies' ];

function quote(value) {
 return "'" + replace(value, /'/g, "'\\''") + "'";
}

return function(ctx) {
 function status(check) {
  let digest = readfile(`${DIR}/package.sha256`);
  let installed = digest != null && readfile(`${DIR}/.installed-sha256`) == digest;
  let result = trim(readfile(`${RUN}/result`) ?? '');
  let installing = result == 'running' && ctx.run(`flock -n ${RUN}/lock true`) != 0;
  if (check && !installing)
   installed = ctx.run(`sh ${DIR}/install.sh check >/dev/null 2>&1`) == 0;
  let error = !installing && result == 'running' ? 'Installation interrupted'
   : !installed && !installing && result != '' && result != '0' ? 'Installation failed' : null;
  return { installed, installing, error,
   log: installing || error ? substr(readfile(`${RUN}/install.log`) ?? '', -6000) : '' };
 }
 function start() {
  ctx.run(`sh ${DIR}/install.sh start`);
  return status(false);
 }
 function installBundle() {
  let digest = readfile(`${DIR}/package.sha256`);
  if (digest != null && readfile(`${DIR}/.install-attempt`) != digest)
   start();
 }
 return {
  'GET /status': function(req) {
   installBundle();
   return status(req.query?.check == '1');
  },
  'POST /install': start,
  // A newly installed bundle is picked up even while the app is closed.
  'GET /notifications': function() {
   installBundle();
   return { notifications: [] };
  },
  'POST /rpc': function(req) {
   let method = req.body?.method;
   if (!(method in METHODS) || type(req.body?.params) != 'object')
    return { status: 400, type: 'application/json', body: '{"ok":false,"error":"invalid","detail":"Invalid eSIM request"}' };
   let output = ctx.sh(`printf '%s' ${quote(sprintf('%J', req.body.params))} | /usr/libexec/rpcd/e5-esim call ${quote(method)}`);
   try { return json(output); }
   catch (e) { return { ok: false, error: 'backend', detail: 'eSIM service unavailable' }; }
  }
 };
};
