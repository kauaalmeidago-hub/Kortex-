import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const envFile=process.argv[2],cwd=fileURLToPath(new URL('../../automation-server/',import.meta.url));
if(process.platform!=='win32'||!envFile||!path.isAbsolute(envFile)||!fs.existsSync(envFile))throw Error('CARD_SUPERVISOR_CONFIGURATION');
const stateDir=path.join(process.env.LOCALAPPDATA,'Kortex','WhatsAppCards');fs.mkdirSync(stateDir,{recursive:true});
fs.writeFileSync(path.join(stateDir,'supervisor.json'),JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
let child,stopping=false,failures=0;
function start(){
 if(stopping)return;
 const log=fs.openSync(path.join(stateDir,'worker.log'),'a');
 child=spawn(process.execPath,['--max-old-space-size=384','--v8-pool-size=1','--env-file='+envFile,fileURLToPath(new URL('local-worker.mjs',import.meta.url))],{cwd,windowsHide:true,stdio:['ignore',log,log]});fs.closeSync(log);
 const began=Date.now();child.once('exit',()=>{if(Date.now()-began>60000)failures=0;else failures++;if(!stopping)setTimeout(start,Math.min(60000,5000*Math.max(1,failures)));});
 child.once('error',()=>{if(!stopping)setTimeout(start,30000);});
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;child?.kill();});
start();
