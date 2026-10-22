import { FileInputError, fileLimits, validateFileMetadata, fileContent, addFileReviews, validateFileReviews } from '../../supabase/functions/_shared/file-inputs.mjs';

const extensions = { 'application/pdf':'pdf', 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp', 'text/plain':'txt', 'text/csv':'csv',
 'application/msword':'doc', 'application/vnd.ms-excel':'xls',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx',
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'xlsx' };
export function messageMedia(message) {
 const type = ['documentMessage','imageMessage','videoMessage','audioMessage','stickerMessage'].find(k => message[k]);
 if (!type) return null;
 const value = message[type], mime = typeof value.mimetype === 'string' ? value.mimetype.split(';')[0].toLowerCase() : '';
 const rawSize = value.fileLength;
 const size = rawSize && typeof rawSize === 'object' ? Number(rawSize.low >>> 0) + Number(rawSize.high || 0) * 4294967296 : Number(rawSize);
 return { type, mime, name: String(value.fileName || `arquivo.${extensions[mime] || 'bin'}`).slice(0,256), size: Number.isSafeInteger(size) && size > 0 ? size : null };
}
export async function readLimitedJson(response, maxBytes) {
 if (Number(response.headers.get('content-length')) > maxBytes) throw new FileInputError('FILE_SIZE','O arquivo ultrapassa o limite de 20 MB. Envie uma versão menor.');
 const reader = response.body?.getReader();
 if (!reader) throw new FileInputError('FILE_DOWNLOAD','Não consegui acessar o arquivo. Envie novamente.');
 let length = 0;
 const parts = [];
 try {
  for (;;) {
   const {done,value} = await reader.read(); if (done) break;
   length += value.byteLength;
   if (length > maxBytes) throw new FileInputError('FILE_SIZE','O arquivo ultrapassa o limite de 20 MB. Envie uma versão menor.');
   parts.push(value);
  }
 } catch (e) { await reader.cancel().catch(()=>{}); throw e; }
 const bytes = new Uint8Array(length);let at=0;
 for (const part of parts) {bytes.set(part,at);at+=part.length;}
 return JSON.parse(new TextDecoder().decode(bytes));
}
export async function loadMessageFile(message, evolution, instance) {
 if (!message.media) return null;
 const media = message.media;
 if (!['documentMessage','imageMessage'].includes(media.type))
  throw new FileInputError('UNSUPPORTED_FILE','Para analisar a demanda, envie PDF, imagem, texto, documento ou planilha. Áudio e vídeo ainda precisam ser enviados como texto ou documento.');
 validateFileMetadata({...media,size:media.size ?? 1});
 let result;
 try {
  // Fetch/decrypt using the configured instance and persisted message key, never a user-provided URL.
  result = await evolution('/chat/getBase64FromMediaMessage/'+encodeURIComponent(instance), {
   method:'POST', body:JSON.stringify({message:{key:message.key},convertToMp4:false}),
   maxBytes:Math.ceil(fileLimits.bytes / 3) * 4 + 65536,
  });
 } catch (e) {
  if (e instanceof FileInputError) throw e;
  throw new FileInputError('FILE_DOWNLOAD','Não consegui acessar o arquivo do WhatsApp. Envie novamente para continuar.');
 }
 const encoded = typeof result?.base64 === 'string' ? result.base64.replace(/^data:[^;,]+;base64,/u,'') : '';
 if (!encoded || encoded.length > Math.ceil(fileLimits.bytes/3)*4 || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded))
  throw new FileInputError('INVALID_FILE','O arquivo está incompleto ou excede 20 MB. Exporte e envie novamente.');
 const bytes = new Uint8Array(Buffer.from(encoded,'base64'));
 if (Buffer.from(bytes).toString('base64') !== encoded)
  throw new FileInputError('INVALID_FILE','O arquivo está incompleto. Envie novamente.');
 const metadata = {id:message.id,name:media.name,mime:media.mime,size:media.size ?? bytes.length};
 return {metadata,content:fileContent(metadata,bytes)};
}
export function withMessageFiles(request, files) {
 if (!files.length) return request;
 const input = request.input[0], data = JSON.parse(input.content);
 data.anexos_disponiveis = files.map(f=>f.metadata);
 input.content = [{type:'input_text',text:JSON.stringify(data)},...files.map(f=>f.content)];
 request.max_output_tokens = Math.max(request.max_output_tokens || 0, 6000);
 return addFileReviews(request, files);
}
export function responseFileReviews(response, files) {
 if (!files.length) return [];
 const value = JSON.parse((response.output ?? []).flatMap(x=>x.content??[]).filter(x=>x.type==='output_text').map(x=>x.text).join(''));
 return validateFileReviews(value.file_reviews, files.map(f=>f.metadata));
}
