'use strict';
import { readfile, writefile, unlink } from 'fs';

let factory = loadfile(ARGV[0], { raw_mode: true })();
let dir = ARGV[1], run = ARGV[2];
let commands = [], rpcCalls = [], present = true, locked = false;
let ctx = {
 run: function(cmd) {
  push(commands, cmd);
  if (index(cmd, '/install.sh start') >= 0) {
   writefile(`${dir}/.install-attempt`, readfile(`${dir}/package.sha256`));
   writefile(`${run}/result`, 'running\n');
   locked = true;
   return 0;
  }
  if (index(cmd, '/install.sh check') >= 0) return present ? 0 : 1;
  if (index(cmd, 'flock -n ') == 0) return locked ? 1 : 0;
  assert(false, `Unexpected command: ${cmd}`);
 },
 sh: function(cmd) { push(rpcCalls, cmd); return '{"running":false}'; }
};
function status(check) {
 return factory(ctx)['GET /status']({ query: check ? { check: '1' } : {} });
}
function notify() { return factory(ctx)['GET /notifications']({}); }

factory(ctx);
for (let i = 0; i < 5; i++) notify();
assert(length(commands) == 0, 'loaded backend and notifications must not run package checks');
factory(ctx)['POST /rpc']({ body: { method: 'job_status', params: {} } });
assert(length(commands) == 0 && length(rpcCalls) == 1, 'ordinary RPC must only call its handler');
for (let i = 0; i < 5; i++) assert(status(false).installed, 'cached installed state');
assert(length(commands) == 0, 'completed status must not spawn commands');
present = false;
assert(!status(true).installed, 'opening the app must detect a removed package');
assert(length(commands) == 1 && index(commands[0], '/install.sh check') >= 0, 'check only once');

unlink(`${dir}/.installed-sha256`);
writefile(`${run}/result`, '1\n');
writefile(`${run}/install.log`, 'download failed');
commands = [];
for (let i = 0; i < 5; i++) {
 notify();
 let state = status(false);
 assert(!state.installing && !state.installed && state.error == 'Installation failed', 'terminal failure state');
 assert(state.log == 'download failed', 'failure log is separate from the error summary');
}
assert(length(commands) == 0, 'failed installation must wait for an explicit retry');
writefile(`${run}/install.log`, sprintf('%7000s', 'latest line'));
let log = status(false).log;
assert(length(log) == 6000 && substr(log, -11) == 'latest line', 'status returns the bounded log tail');

writefile(`${dir}/package.sha256`, 'updated bundle\n');
notify();
assert(length(commands) == 2, 'new bundle starts once, then reads its active lock');
assert(index(commands[0], '/install.sh start') >= 0, 'new bundle starts installation');
commands = [];
for (let i = 0; i < 5; i++) notify();
assert(length(commands) == 0, 'notification polls must not restart an active installation');
assert(status(false).installing, 'active installation is polled');
assert(length(commands) == 1 && index(commands[0], 'flock -n ') == 0, 'active poll only checks the lock');

locked = false;
assert(status(false).error == 'Installation interrupted', 'lost worker must become a terminal error');
writefile(`${dir}/.installed-sha256`, readfile(`${dir}/package.sha256`));
writefile(`${run}/result`, '0\n');
commands = [];
for (let i = 0; i < 5; i++) {
 notify();
 assert(status(false).installed, 'successful install state');
}
assert(length(commands) == 0, 'successful installation must leave polling idle');
print('Backend installation checks passed\n');
