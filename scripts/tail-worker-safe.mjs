import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const child=spawn(process.execPath,[fileURLToPath(new URL('../cloudflare/worker/node_modules/wrangler/bin/wrangler.js',import.meta.url)),'tail','--format','json'],{cwd:new URL('../cloudflare/worker/',import.meta.url),stdio:['ignore','pipe','pipe']});
let buffer='';let depth=0;let quoted=false;let escaped=false;let start=-1;
child.stdout.on('data',chunk=>{for(const char of chunk.toString()){buffer+=char;if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;}else if(char==='"')quoted=true;else if(char==='{'){if(depth===0){buffer='{';start=0;}depth++;}else if(char==='}'){depth--;if(depth===0&&start===0){try{const event=JSON.parse(buffer);console.log(JSON.stringify({outcome:event.outcome,logs:event.logs?.map(l=>l.message),exceptions:event.exceptions?.map(e=>({name:e.name}))}));}catch{}buffer='';start=-1;}}}});
setTimeout(()=>child.kill(),45000);
