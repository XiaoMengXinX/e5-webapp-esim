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
 function status() {
  let installed = ctx.run(`sh ${DIR}/install.sh check >/dev/null 2>&1`) == 0;
  let installing = ctx.run(`test -f ${RUN}/lock && ! flock -n ${RUN}/lock true`) == 0;
  let result = trim(readfile(`${RUN}/result`) ?? '');
  return { installed, installing,
   error: !installed && !installing && result != '' && result != '0'
    ? substr(readfile(`${RUN}/install.log`) ?? 'Installation failed', -6000) : null };
 }
 function start() {
  ctx.run(`sh ${DIR}/install.sh start`);
  return status();
 }
 // The host polls this backend after installing the app, including while its UI is closed.
 if (ctx.run(`sh ${DIR}/install.sh check >/dev/null 2>&1`) != 0 &&
     (readfile(`${RUN}/attempt.sha256`) != readfile(`${DIR}/package.sha256`) ||
      trim(readfile(`${RUN}/result`) ?? '') == '0'))
  start();
 return {
  'GET /status': status,
  'POST /install': start,
  'GET /notifications': function() { return { notifications: [] }; },
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
