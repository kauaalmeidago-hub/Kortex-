// Local preview with the existing staging backend. Only public configuration enters Vite.
import {spawn} from 'node:child_process';
import {stagingConfiguration} from './staging-preflight.mjs';
const {env}=await stagingConfiguration({requireDatabase:false});
const publicEnv=Object.fromEntries(Object.entries(env).filter(([key])=>key.startsWith('VITE_')));
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5184','--strictPort','--mode','staging'],{
 env:{...process.env,...publicEnv},stdio:'inherit',windowsHide:true});
process.on('SIGINT',()=>vite.kill());process.on('SIGTERM',()=>vite.kill());
