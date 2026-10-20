// Developer browser acceptance in a fresh ephemeral profile; only QA/localhost.
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {spawn,execFile} from 'node:child_process';import {promisify} from 'node:util';
import {stagingConfiguration,stagingReference} from './staging-preflight.mjs';
const require=createRequire(new URL('../../automation-server/package.json',import.meta.url));const {chromium}=require('playwright'),{createClient}=require('@supabase/supabase-js');
const {env}=await stagingConfiguration({requireDatabase:false});const f=JSON.parse(await fs.readFile('tmp/task-initial-fixture.json','utf8'));assert.equal(f.project,stagingReference);
const root=JSON.parse(await fs.readFile('tmp/task-initial-release-source.json','utf8')).root;
const publicEnv=Object.fromEntries(Object.entries(env).filter(([k])=>k.startsWith('VITE_')));Object.assign(publicEnv,{VITE_APP_ENV:'production',VITE_AUTOMATION_API_URL:'',VITE_AUTOMATION_API_TOKEN:'',VITE_KOA_DEFAULT_COMPANY_ID:'',VITE_KOA_DEFAULT_WORKSPACE_ID:''});
await promisify(execFile)(process.execPath,['node_modules/vite/bin/vite.js','build','--mode','production','--outDir','tmp/qa-dist'],{cwd:root,env:{...process.env,...publicEnv},windowsHide:true,timeout:600000,maxBuffer:4*1024*1024});
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--outDir','tmp/qa-dist','--host','127.0.0.1','--port','5183','--strictPort'],{cwd:root,windowsHide:true,stdio:'ignore'});
let browser;const report={backend:stagingReference,sourceRoot:root,productionMutated:false,checks:[],measurements:[],screenshots:[]};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
 for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:5183')).ok)break;}catch{}await pause(250);}
 const c=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const auth=await c.auth.signInWithPassword({email:f.email,password:f.password});assert.ok(!auth.error);
 browser=await chromium.launch({channel:'chrome',headless:true});const ctx=await browser.newContext({viewport:{width:1366,height:768},colorScheme:'dark'});
 await ctx.route('**/*',r=>['http://127.0.0.1:5183',env.VITE_SUPABASE_URL,'https://fonts.googleapis.com','https://fonts.gstatic.com'].includes(new URL(r.request().url()).origin)?r.continue():r.abort());
 await ctx.addInitScript(({session,ref})=>{localStorage.setItem('crm-theme-mode','dark');localStorage.setItem('sb-'+ref+'-auth-token',JSON.stringify(session));},{session:auth.data.session,ref:stagingReference});
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5183/admin/tasks?board='+f.board);await page.getByRole('heading',{name:'Qual tarefa vamos realizar hoje e para qual setor?'}).waitFor();
 const input=page.getByRole('textbox',{name:'Mensagem para Gestão de tarefas'});await page.waitForFunction(()=>document.querySelector('.task-admin')?.getAttribute('data-conversation-id'));
 const conversation=await page.locator('.task-admin').getAttribute('data-conversation-id');assert.equal(conversation,f.conversation);
 assert.equal(await page.locator('.task-admin-toolbar button').count(),1);assert.equal(await page.locator('.task-admin-toolbar select').count(),0);
 report.checks.push('Clean initial state: only Setores in the header; transparent document asset and exact title, subtitle and placeholder.');
 for(const {width,height} of [{width:1366,height:768},{width:1280,height:560},{width:1920,height:1080},{width:412,height:824},{width:360,height:420}]){
  await page.setViewportSize({width,height});
  const m=await page.evaluate(()=>{const b=e=>{const r=e.getBoundingClientRect();return {width:r.width,height:r.height,top:r.top,bottom:r.bottom};};return {composer:b(document.querySelector('.task-chat-composer')),send:b(document.querySelector('.koa-chat-send')),sectors:b(document.querySelector('.task-sectors-button')),icon:b(document.querySelector('.task-admin-empty .task-admin-brand')),font:getComputedStyle(document.querySelector('textarea')).fontFamily,overflow:document.documentElement.scrollWidth>innerWidth,light:!document.documentElement.classList.contains('dark')};});
  assert.ok(m.composer.height>=88&&m.composer.height<=104,JSON.stringify(m));assert.equal(m.send.width,60);assert.equal(m.send.height,width<768?44:36);assert.equal(m.sectors.height,width<768?44:36);assert.ok(m.send.bottom<=height&&m.send.top>=0);assert.equal(m.overflow,false);assert.equal(m.light,true);assert.ok(m.font.includes('Inter'));
  report.measurements.push({viewport:width+'x'+height,...m});const file='task-initial-'+width+'x'+height+'.png';await page.screenshot({path:'outputs/isolation/'+file});report.screenshots.push(file);
 }
 report.checks.push('Measured compact desktop controls, mobile touch targets and a reduced 360×420 usable area without horizontal overflow or clipped send controls.');
 if(process.argv.includes('--resume')){
  await page.setViewportSize({width:1366,height:768});
  const before=await c.from('tasks').select('id').eq('workspace_id',f.workspace);assert.ok(!before.error);
  await input.fill('Pedido posterior ao retorno visual, na mesma conversa operacional.');await page.getByRole('button',{name:'Enviar',exact:true}).click();await page.getByRole('status').filter({hasText:'Mensagem registrada.'}).waitFor();
  const after=await c.from('tasks').select('id').eq('workspace_id',f.workspace);assert.deepEqual(after.data,before.data);
  const histories=await c.from('task_conversations').select('id').eq('workspace_id',f.workspace);assert.deepEqual(histories.data,[{id:conversation}]);
  report.checks.push('A new request after the elapsed confirmed-cycle deadline reuses the conversation and does not recreate the previously confirmed task.');
  await page.reload();await page.getByRole('heading',{name:'Resumo das tarefas',exact:true}).waitFor();assert.equal(await page.locator('.task-admin').getAttribute('data-conversation-id'),conversation);
  report.checks.push('Reload after the new request preserves previous receipts, the new message and the same conversation.');
 }else{
 await page.setViewportSize({width:1366,height:768});await input.fill(Array(35).fill('Mensagem longa para medir a rolagem interna.').join('\n'));const area=await input.boundingBox();assert.ok(area.height<=144);await input.fill('Texto preservado ao escolher setores');
 await page.getByRole('button',{name:'Setores',exact:true}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');assert.equal(await input.inputValue(),'Texto preservado ao escolher setores');
 await page.reload();await input.waitFor();await page.waitForFunction(()=>document.querySelector('.task-admin')?.getAttribute('data-conversation-id'));assert.equal(await input.inputValue(),'Texto preservado ao escolher setores');assert.equal(await page.locator('.task-admin').getAttribute('data-conversation-id'),conversation);
 report.checks.push('Long text scrolls internally; opening Setores and reloading preserve unsent text and conversation identity.');
 await input.fill('Primeiro pedido de homologação da conversa única.');await page.getByRole('button',{name:'Enviar',exact:true}).click();await page.getByRole('status').filter({hasText:'Mensagem registrada.'}).waitFor();await input.fill('Segundo pedido de homologação, na mesma conversa.');await page.getByRole('button',{name:'Enviar',exact:true}).click();await page.getByRole('status').filter({hasText:'Mensagem registrada.'}).waitFor();
 const messages=await c.from('task_messages').select('id').eq('conversation_id',conversation).eq('role','user');assert.ok(!messages.error);assert.equal(messages.data.length,2);
 const histories=await c.from('task_conversations').select('id').eq('workspace_id',f.workspace);assert.equal(histories.data.length,1);
 report.checks.push('Two actual saved messages reuse the same operational ID; no additional conversation or invented AI result.');
 const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.getByRole('button',{name:'Anexar arquivo',exact:true}).click()]);
 await chooser.setFiles({name:'antes-de-enviar.txt',mimeType:'text/plain',buffer:Buffer.from('Anexo de QA removido antes do envio.')});await page.getByRole('button',{name:'Remover antes-de-enviar.txt'}).waitFor();
 const attachments=await c.from('task_attachments').select('id').eq('workspace_id',f.workspace);assert.equal(attachments.data.length,0);
 await page.getByRole('button',{name:'Remover antes-de-enviar.txt'}).click();assert.equal(await page.getByRole('list',{name:'Arquivos selecionados'}).count(),0);
 report.checks.push('File selection remains local and removable before send; no Storage or draft record created by selecting a file.');
 await page.getByRole('button',{name:'Setores',exact:true}).click();await page.getByText('Ferramentas administrativas',{exact:true}).click();await page.getByRole('button',{name:'Preencher manualmente',exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByLabel('Título da tarefa',{exact:true}).fill('Homologação do campo compacto');
 await page.locator('select[name=assigned_to]').selectOption(f.userId);await page.getByRole('button',{name:'Salvar rascunho',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.getByRole('heading',{name:'Resumo das tarefas',exact:true}).waitFor();
 report.checks.push('The preserved manual review writes a real draft in the same operational conversation.');
 const [uploadChooser]=await Promise.all([page.waitForEvent('filechooser'),page.getByRole('button',{name:'Anexar arquivo',exact:true}).click()]);
 await uploadChooser.setFiles({name:'enviado-explicitamente.txt',mimeType:'text/plain',buffer:Buffer.from('Upload exclusivo de homologação.')});
 await page.getByRole('button',{name:'Remover enviado-explicitamente.txt'}).waitFor();await page.getByRole('button',{name:'Enviar',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Anexos enviados.'}).waitFor();
 const uploaded=await c.from('task_attachments').select('id,draft_id').eq('workspace_id',f.workspace);assert.equal(uploaded.data.length,1);
 report.checks.push('Explicit send uploads the selected file through the existing Storage service into the chosen persisted draft.');
 await page.getByRole('checkbox',{name:'Selecionar Homologação do campo compacto',exact:true}).check();await page.getByRole('button',{name:'Aprovar e encaminhar (1)',exact:true}).click();
 await page.getByRole('status').filter({hasText:'1 tarefa encaminhada.'}).waitFor();
 const confirmed=await c.from('task_drafts').select('id,confirmed_task_id,payload').eq('conversation_id',conversation);assert.equal(confirmed.data.length,1);assert.ok(confirmed.data[0].confirmed_task_id);
 const task=await c.from('tasks').select('id,status,stage_id').eq('id',confirmed.data[0].confirmed_task_id).single();assert.ok(!task.error);assert.notEqual(task.data.status,'done');assert.equal(task.data.stage_id,confirmed.data[0].payload.stage_id);
 report.checks.push('Actual confirmation creates one task in its original operational stage; the result is displayed without completing the assigned work.');
 await page.reload();await page.waitForFunction(()=>document.querySelector('.task-admin')?.getAttribute('data-conversation-id'));assert.equal(await page.locator('.task-admin').getAttribute('data-conversation-id'),conversation);
 report.checks.push('Reload after actual confirmation keeps the operational conversation and saved task identity.');
 }
 assert.equal(errors.length,0,JSON.stringify(errors));report.checks.push('No browser page errors.');report.completedAt=new Date().toISOString();
}catch(e){report.failedCode=e.message;process.exitCode=1;console.error('INITIAL_BROWSER_CHECK_FAILED',e.message);}
finally{if(browser)await browser.close();server.kill();await fs.writeFile('outputs/isolation/task-initial-browser-checks.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:!report.failedCode,checks:report.checks.length,viewports:report.measurements.length}));
