import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const r=JSON.parse(fs.readFileSync(new URL('../.gateway-runtime.local.json',import.meta.url),'utf8'));
const result=spawnSync(process.execPath,[fileURLToPath(new URL('../cloudflare/worker/node_modules/wrangler/bin/wrangler.js',import.meta.url)),'secret','put','MCP_SERVICE_TOKEN'],{cwd:new URL('../cloudflare/worker/',import.meta.url),input:r.serviceToken,encoding:'utf8'});
let output=(result.stdout||'')+(result.stderr||'');
for(const secret of [r.password,r.serviceToken])output=output.split(secret).join('[REDACTED]');
console.log(output);process.exitCode=result.status??1;
