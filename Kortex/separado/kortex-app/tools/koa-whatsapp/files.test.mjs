import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Inbox,normalizeMessage,modelRequest,greetingReplies} from './core.mjs';
import {loadMessageFile,withMessageFiles,responseFileReviews,readLimitedJson} from './files.mjs';
import {supportedRoute} from './tasks.mjs';
import {fileContent,validateFileBytes,validateFileBatch,requireReadableFiles} from '../../supabase/functions/_shared/file-inputs.mjs';
const raw=(id='file',message={documentMessage:{fileName:'pedido.txt',mimetype:'text/plain',fileLength:23,caption:'KOA, prepare esta tarefa',url:'https://untrusted.invalid',mediaKey:'private'}})=>({
 key:{id,remoteJid:'g@g.us',participant:'one@s.whatsapp.net'},message,messageTimestamp:100,
});
const response=file_reviews=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({file_reviews})}]}]});
const review={id:'file',readable:true,summary:'Pedido de cotação da Empresa A.',evidence:'Preparar nova cotação',issues:[]};
test('documents, caption wrappers and captionless images retain only scoped media metadata',()=>{
 const message=normalizeMessage(raw());
 assert.equal(message.media.name,'pedido.txt');assert.equal(message.media.size,23);
 assert.doesNotMatch(JSON.stringify(message),/untrusted|mediaKey|private/);
 assert.equal(greetingReplies({...message,text:'KOA'},{}),null);
 const image=normalizeMessage(raw('image',{ephemeralMessage:{message:{imageMessage:{mimetype:'image/png',fileLength:{low:100,high:0},contextInfo:{stanzaId:'out'}}}}}));
 assert.equal(image.text,'');assert.equal(image.quoted,'out');assert.equal(image.media.name,'arquivo.png');
 assert.equal(normalizeMessage(raw('wrapped',{documentWithCaptionMessage:{message:{documentMessage:{fileName:'lista.csv',caption:'KOA, leia',mimetype:'text/csv'}}}})).media.name,'lista.csv');
});
test('WhatsApp retrieval uses message key and instance; validates bytes before model input',async()=>{
 const message=normalizeMessage(raw()),bytes=Buffer.from('Preparar nova cotação');
 message.media.size=bytes.length;
 const calls=[];
 const file=await loadMessageFile(message,async(path,options)=>{calls.push([path,options]);return {base64:bytes.toString('base64')};},'authorized');
 assert.equal(calls[0][0],'/chat/getBase64FromMediaMessage/authorized');
 assert.deepEqual(JSON.parse(calls[0][1].body),{message:{key:message.key},convertToMp4:false});
 const request=withMessageFiles(modelRequest('configured-model',message,{},'direct'),[file]);
 assert.equal(request.input[0].content[1].file_data,'data:text/plain;base64,'+bytes.toString('base64'));
 assert.equal(JSON.parse(request.input[0].content[0].text).anexos_disponiveis[0].id,'file');
 assert.ok(request.text.format.schema.required.includes('file_reviews'));
 assert.deepEqual(responseFileReviews(response([review]),[file]),[review]);
 assert.throws(()=>responseFileReviews(response([{...review,id:'other'}]),[file]));
 assert.throws(()=>requireReadableFiles([{...review,readable:false}]));
});
test('invalid bytes, MIME disguise, oversized bodies and unsupported media are rejected',async()=>{
 assert.throws(()=>fileContent({name:'fake.pdf',size:4,mime:'application/pdf'},new Uint8Array([1,2,3,4])),/inválido/);
 assert.throws(()=>fileContent({name:'fake.txt',size:2,mime:'application/pdf'},new Uint8Array([65,66])),/extensão/);
 assert.throws(()=>validateFileBatch(Array.from({length:6},()=>({name:'a.txt',size:1}))),/5 arquivos/);
 const encrypted=Buffer.from('%PDF-1.7\n/Encrypt 1 0 R\n%%EOF');
 assert.throws(()=>validateFileBytes({name:'locked.pdf',size:encrypted.length},encrypted),/senha/);
 const binary=Buffer.from([80,75,3,4,0,0,0,0]);
 assert.throws(()=>validateFileBytes({name:'wrong.docx',size:binary.length},binary),/inválido/);
 const audio=normalizeMessage(raw('audio',{audioMessage:{mimetype:'audio/ogg'}}));
 let called=false;
 await assert.rejects(loadMessageFile(audio,async()=>{called=true;},'x'),/Áudio/);assert.equal(called,false);
 await assert.rejects(readLimitedJson(new Response('more than allowed'),3),/20 MB/);
 const partial=normalizeMessage(raw());partial.media.size=5;
 await assert.rejects(loadMessageFile(partial,async()=>({base64:Buffer.from('AB').toString('base64')}),'x'),/incompleto/);
});
test('file followups and summaries stay within the participant and group',()=>{
 const inbox=new Inbox(':memory:'),config={instance:'instance',group_jid:'g@g.us',activated_at:new Date(0).toISOString()};
 try{
  inbox.ingest({event:'messages.upsert',instance:'instance',data:raw()},config,100000);
  inbox.rememberFiles('file',[review]);inbox.db.prepare("UPDATE inbox SET state='sent' WHERE id='file'").run();
  const next={...normalizeMessage(raw('next',{conversation:'KOA, use esse arquivo'})),timestamp:101};
  assert.equal(inbox.fileMessages(next)[0].id,'file');assert.equal(inbox.context(next).arquivos_lidos[0].evidence,review.evidence);
  const other={...next,participant:'two@s.whatsapp.net',quoted:'file'};
  assert.deepEqual(inbox.fileMessages(other),[]);assert.deepEqual(inbox.context(other).arquivos_lidos,[]);
  inbox.ingest({event:'messages.upsert',instance:'instance',data:raw('file2')},config,100000);
  assert.equal(inbox.fileMessages(next).length,2);
  assert.deepEqual(inbox.fileMessages({...next,quoted:'file'}).map(m=>m.id),['file']);
 }finally{inbox.close();}
});
test('file evidence supports operational responsibility but cannot authorize explicit sector instructions',()=>{
 const task={sector:'comercial',route_source:'responsibility',route_evidence:'Preparar nova cotação'};
 const context={arquivos_lidos:[review]},message={text:'KOA, crie a tarefa descrita no anexo'};
 assert.equal(supportedRoute(task,message,context),true);
 assert.equal(supportedRoute(task,message,{arquivos_lidos:[{...review,readable:false}]}),false);
 assert.equal(supportedRoute({...task,route_source:'explicit',route_evidence:'Comercial'},message,{arquivos_lidos:[{...review,evidence:'Comercial'}]}),false);
});
