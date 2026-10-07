import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const r=JSON.parse(fs.readFileSync(new URL('../.gateway-runtime.local.json',import.meta.url),'utf8'));
const cwd=new URL('../cloudflare/worker/',import.meta.url);
const cli=new URL('../cloudflare/worker/node_modules/wrangler/bin/wrangler.js',import.meta.url);
const args=['hyperdrive','create','manufact-jsicrm-fresh','--origin-host',r.host,'--origin-port',String(r.port),'--origin-scheme','mysql','--database',r.database,'--origin-user',r.user,'--origin-password',r.password,'--caching-disabled','--ca-certificate-id','8dba6d67-2bee-4b50-b39e-2fa62f40fc73','--sslmode','VERIFY_IDENTITY','--origin-connection-limit','5'];
const result=spawnSync(process.execPath,[cli.pathname.replace(/^\//,'').replaceAll('%20',' ').replaceAll('%C4%87','ć'),...args],{cwd,encoding:'utf8'});
let output=(result.stdout||'')+(result.stderr||'');
for(const secret of [r.password,r.serviceToken])output=output.split(secret).join('[REDACTED]');
console.log(output);
process.exitCode=result.status??1;

