import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const r=JSON.parse(fs.readFileSync(new URL('../.gateway-runtime.local.json',import.meta.url),'utf8'));
const cli=fileURLToPath(new URL('../node_modules/mcp-use/dist/bin.js',import.meta.url));
const server='77a6298d-34e9-4d70-9454-d47c8d300361';
for(const [key,value,secret] of [['CRM_TRANSPORT','cloudflare',false],['CRM_WORKER_BASE_URL','https://manufact-db-rollback.6f484zn9bd.workers.dev',false],['CRM_WORKER_SERVICE_TOKEN',r.serviceToken,true]]) {
 const result=spawnSync(process.execPath,[cli,'servers','env','set',server,key+'='+value,...(secret?['--secret']:[]),'--json'],{encoding:'utf8'});
 let output=(result.stdout||'')+(result.stderr||'');for(const s of [r.password,r.serviceToken])output=output.split(s).join('[REDACTED]');console.log(output);
 if(result.status!==0){process.exitCode=1;break;}
}
fs.mkdirSync(new URL('../.mcp-use/cloud/',import.meta.url),{recursive:true});
fs.writeFileSync(new URL('../.mcp-use/cloud/link.json',import.meta.url),JSON.stringify({organizationId:'e6cca7af-6a12-42da-aa3a-71a893f01488',serverId:server,serverSlug:'keen-forge-ldf39',repository:'dsactivi-2/Manufact-DB-Roleback-MCP',sourceType:'github'},null,2));
