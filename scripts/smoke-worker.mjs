import fs from 'node:fs';
const r=JSON.parse(fs.readFileSync(new URL('../.gateway-runtime.local.json',import.meta.url),'utf8'));
const base='https://manufact-db-rollback.6f484zn9bd.workers.dev';
for(const [name,path,body,auth] of [['health','/health',undefined,false],['unauthenticated','/v1/read/stats',{},false],['stats','/v1/read/stats',{},true]]) {
 const response=await fetch(base+path,{method:body?'POST':'GET',headers:body?{'content-type':'application/json',...(auth?{authorization:'Bearer '+r.serviceToken}:{})}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
 const data=await response.json();
 console.log(JSON.stringify({check:name,status:response.status,result:data}));
 if(response.status!==(name==='unauthenticated'?401:200))process.exitCode=1;
}
