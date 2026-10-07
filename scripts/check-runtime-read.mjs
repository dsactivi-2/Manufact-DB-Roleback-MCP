import fs from 'node:fs';
import mysql from 'mysql2/promise';
import {aivenProjectCa} from '../src/aiven-ca.ts';

const r=JSON.parse(fs.readFileSync(new URL('../.gateway-runtime.local.json',import.meta.url),'utf8'));
let c;
try{c=await mysql.createConnection({host:r.host,port:r.port,user:r.user,password:r.password,database:r.database,ssl:{ca:aivenProjectCa,rejectUnauthorized:true}});await c.query('START TRANSACTION READ ONLY');const [result]=await c.query('SELECT (SELECT COUNT(*) FROM idk_kandidati) AS kandidaten, (SELECT COUNT(*) FROM idk_kandidati WHERE kandidat_status <> 3) AS aktiv, (SELECT COUNT(*) FROM idk_companies) AS firmen, (SELECT COUNT(*) FROM idk_nalozi) AS auftraege');console.log(JSON.stringify({ok:true,result}));}catch(e){console.log(JSON.stringify({ok:false,code:e.code,errno:e.errno}));process.exitCode=1;}finally{if(c)await c.end();}

