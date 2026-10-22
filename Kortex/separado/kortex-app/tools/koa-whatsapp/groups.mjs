const clean=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const jid=value=>typeof value==='string'&&/^\d+@(s\.whatsapp\.net|lid)$/.test(value);
export const mentionToken='{{mencoes}}';
const noAction=()=>({kind:'none',names:[],everyone:false});

export function groupCommand(text){
 return /^(?:por favor[,\s]+)?(?:cham[ae]|chamem|chame|mencion[ae]|marqu[ee]|marca|convoqu[ee]|avise|pergunte\s+(?:a|ao|à|para)|se\s+apresente|apresente-se)\s+\S/iu.test(text.trim());
}
export function everyoneRequested(text){
 const value=clean(text);
 return !/\bnao\s+(?:\w+\s+){0,2}(?:mencione|marque|chame|chama|marcar|mencionar|chamar)\b/u.test(value)
  && /\b(?:mencion\w*|marq\w*|marca\w*|cham\w*|convo\w*|avis\w*|notifi\w*)\b.{0,100}\b(?:todos|todas|geral|grupo inteiro)\b/u.test(value);
}

// Names are display labels, never proof of identity or administrative rights.
// Contacts and verified aliases are joined ONLY to current group members.
export function groupDirectory(participants,contacts=[],profiles=[],botJid=''){
 if(!Array.isArray(participants)||!participants.length)throw Error('GROUP_MEMBERS_UNAVAILABLE');
 return participants.map(p=>{
  const aliases=[...new Set([p.id,p.phoneNumber,p.jid,p.lid].filter(jid))];
  if(!aliases.length)throw Error('GROUP_MEMBER_INVALID');
  const names=[p.name,p.notify,...contacts.filter(c=>aliases.includes(c.remoteJid)).map(c=>c.pushName),
   ...profiles.filter(n=>aliases.includes(n.participant)||aliases.includes(n.canonical_participant)).map(n=>n.display_name)]
   .filter(n=>typeof n==='string'&&n.trim()).map(n=>n.trim().slice(0,180));
  return {jid:aliases.find(a=>a.endsWith('@s.whatsapp.net'))??aliases[0],aliases,names:[...new Set(names)],self:aliases.includes(botJid)};
 }).filter(p=>!p.self);
}
export function resolveNames(names,directory){
 const resolved=[],missing=[],ambiguous=[];
 for(const name of names){
  const key=clean(name),number=String(name).replace(/^@/u,'').trim();
  // Exact full names win; a partial name must match whole consecutive words.
  const exact=directory.filter(p=>p.names.some(n=>clean(n)===key)||p.aliases.some(a=>a===number||a.split('@')[0]===number));
  const matches=exact.length?exact:directory.filter(p=>key&&p.names.some(n=>(' '+clean(n)+' ').includes(' '+key+' ')));
  if(matches.length===1)resolved.push(matches[0]);else (matches.length?ambiguous:missing).push(name);
 }
 return {members:[...new Map(resolved.map(p=>[p.jid,p])).values()],missing,ambiguous};
}

export function withGroupActions(request){
 request.instructions+=`\n\nCHAMADAS REAIS NO GRUPO
O servidor pode mencionar integrantes atuais do grupo e enviar uma apresentação solicitada. Use group_action.kind=mention apenas quando houver pedido concreto de chamar, mencionar, avisar ou perguntar a uma pessoa: "chame Fernando", "marque Jean e Cristiano", "pergunte ao Fernando qual o prazo". Uma chamada é conversa e NÃO cria tarefa por si só, mesmo sendo um pedido de ação. Uma dúvida sobre como mencionar, uma hipótese, uma ordem negada ou uma conversa entre terceiros usa kind=none. Para quem responder a uma chamada, use contexto.chamada_recebida e responda só se a mensagem realmente continuar o assunto.
Em names, copie apenas os nomes ou @números solicitados pelo participante, sem inventar contatos, cargos ou números. O servidor confere a lista atual e resolve nomes ambíguos. Para uma chamada, escreva a pergunta/convite no último text de replies com o marcador literal ${mentionToken} no lugar das menções, por exemplo "${mentionToken}, pode informar o prazo da cotação?". Nunca diga que a pessoa já foi avisada ou respondeu. Se já houver uma pergunta concreta, dirija essa pergunta à pessoa; não faça uma chamada genérica perdendo o assunto. Uma menção não atribui tarefa nem comprova recebimento/leitura.
Use everyone=true somente se o participante pedir explicitamente para mencionar/chamar todos. Fora desse caso, everyone=false. Não chame todos por iniciativa própria. Use kind=introduction quando pedirem uma apresentação do KOA para o grupo; o servidor escreve o texto com as capacidades realmente habilitadas. Apresentação coletiva é diferente do cumprimento individual. Em kind=none, names=[] e everyone=false. Um pedido só de apresentação/chamada usa replies com uma resposta curta e, quando existir o modo de tarefas, intent=conversation e tasks=[]. Não deixe a limitação de criação de tarefas impedir uma chamada no WhatsApp: menções estão disponíveis. Não revele identificadores internos.
Exemplos obrigatórios de classificação:
- "Koa, se apresente para o grupo e mencione todos no final": group_action={"kind":"introduction","names":[],"everyone":true}.
- "Koa, se apresente para o grupo": group_action={"kind":"introduction","names":[],"everyone":false}.
- "Koa, se eu pedir para chamar Fernando, você pode mencionar ele?": é PERGUNTA HIPOTÉTICA, group_action={"kind":"none","names":[],"everyone":false}. Explique a capacidade, sem fazer a chamada.
- Se o motivo for "resposta de participante chamado pelo KOA", isso é só uma continuação CANDIDATA. Se a chamada perguntava o prazo e a pessoa escreve "Jean, obrigado pela ajuda de ontem com o carro", ela fala com Jean sobre outro assunto: should_reply=false, replies=[], group_action={"kind":"none","names":[],"everyone":false}. Não se passe por Jean nem agradeça em nome dele.
- Se a chamada perguntava o prazo e a pessoa responde "O prazo é amanhã", reconheça o retorno brevemente, sem repetir a resposta como se fosse sua própria informação.`;
 const envelope=JSON.parse(request.input[0].content);
 if(envelope.motivo_da_chamada==='pedido de chamada ou apresentação no grupo')request.instructions+='\nA mensagem ATUAL é um pedido dirigido diretamente ao KOA, reconhecido pelo servidor pelo verbo de comando. Ela NÃO precisa conter o nome KOA. Para "Chame Jean para responder aqui.", retorne should_reply=true, replies=[{"topic":"Chamada de Jean","text":"{{mencoes}}, pode responder aqui?"}], group_action={"kind":"mention","names":["Jean"],"everyone":false}. Não marque should_reply=false nesse pedido direto.';
 if(envelope.motivo_da_chamada==='resposta de participante chamado pelo KOA')request.instructions+='\nA mensagem ATUAL veio do próprio participante que o KOA acabou de mencionar. O nome KOA não precisa ser repetido na resposta. Use contexto.chamada_recebida como a pergunta a que ele pode estar respondendo. Exemplo completo: chamada_recebida="@551100001, qual é o prazo da cotação?", mensagem="O prazo da cotação é amanhã.": should_reply=true, replies=[{"topic":"Prazo da cotação","text":"Obrigado pelo retorno sobre o prazo da cotação."}], group_action={"kind":"none","names":[],"everyone":false}. Resposta sobre outro assunto e dirigida a outra pessoa continua should_reply=false.';
 const schema=request.text.format.schema;
 schema.properties.group_action={type:'object',additionalProperties:false,properties:{kind:{type:'string',enum:['none','mention','introduction']},names:{type:'array',items:{type:'string'},maxItems:20},everyone:{type:'boolean'}},required:['kind','names','everyone']};
 schema.required.push('group_action');
 schema.properties={group_action:schema.properties.group_action,...schema.properties};
 return request;
}
export function parseGroupAction(response){
 if(response?.status!=='completed')throw Error('AI_INCOMPLETE');
 const data=JSON.parse((response.output??[]).flatMap(x=>x.content??[]).filter(x=>x.type==='output_text').map(x=>x.text).join(''));
 const action=data.group_action;
 if(!action||!['none','mention','introduction'].includes(action.kind)||!Array.isArray(action.names)||action.names.length>20
  ||action.names.some(n=>typeof n!=='string'||!n.trim()||n.length>180)||typeof action.everyone!=='boolean'
  ||action.kind==='none'&&(action.names.length||action.everyone)||action.kind!=='none'&&!data.should_reply
  ||action.kind==='mention'&&!action.everyone&&!action.names.length)throw Error('AI_INVALID_GROUP_ACTION');
 return action;
}
export function normalizeGroupAction(action,message){
 const text=clean(message.text);
 // A hypothetical capability question must never become an external ping.
 if(/\b(?:(?:se|caso|quando) eu|como (?:eu )?(?:posso|faco para)|o que acontece se)\b/u.test(text)
  ||/\bnao (?:se )?(?:apresente|faca (?:uma )?apresentacao|chame|chama|mencione|marque)\b/u.test(text))return noAction();
 if(/\b(?:se apresente|apresente se|faca (?:uma |a )?apresentacao)\b/u.test(text)&&/\b(?:grupo|pessoal|todos|todas)\b/u.test(text))return {kind:'introduction',names:[],everyone:everyoneRequested(message.text)};
 return action;
}
export function addressedToOtherMember(message,directory){
 const prefix=message.text.match(/^@?([^,!?:\n]{1,180})[,!?:]/u)?.[1];
 return Boolean(prefix&&resolveNames([prefix],directory).members.length);
}
export function introductionText(tasksEnabled=false){
 return 'Olá, pessoal! 🤖 Sou o KOA, assistente virtual da Alaive aqui no grupo.\n\n'
  +'Posso ajudar com dúvidas, organizar as informações das demandas e orientar o direcionamento entre Comercial e Relacionamento. '
  +(tasksEnabled?'Quando vocês me pedirem uma tarefa com as informações necessárias, posso registrá-la no setor habilitado e confirmar o resultado aqui.':'Para registrar e acompanhar tarefas, utilizem a plataforma Kortex.')
  +'\n\nPara falar comigo, escrevam “Koa” junto da pergunta ou respondam a uma mensagem minha. Se precisarem de alguém, peçam, por exemplo: “Koa, chame Fernando para informar o prazo”. Eu menciono a pessoa aqui no grupo; ela também pode responder diretamente à minha chamada.'
  +'\n\nContem comigo para facilitar a comunicação e a organização das demandas!';
}
export function composeGroupReplies(replies,action,message,context,directory,tasksEnabled=false){
 if(!action||action.kind==='none')return replies;
 const clarify=text=>[...(action.kind==='mention'?replies.slice(0,-1):[]),text];
 if(action.everyone&&!everyoneRequested(message.text))return clarify('Para mencionar o grupo inteiro, peça explicitamente para chamar todos.');
 const evidence=clean([message.text,...(context.interacoes??[]).map(x=>x.participante)].join(' '));
 if(action.names.some(name=>!(' '+evidence+' ').includes(' '+clean(name)+' ')))return clarify('Quem você quer chamar? Escreva o nome ou marque a pessoa com @.');
 const result=action.everyone?{members:directory,missing:[],ambiguous:[]}:resolveNames(action.names,directory);
 if(result.ambiguous.length)return clarify(`Encontrei mais de uma pessoa para ${result.ambiguous.join(', ')}. Pode informar o nome completo ou marcá-la com @?`);
 if(result.missing.length)return clarify(`Não consegui identificar ${result.missing.join(', ')} entre os participantes atuais do grupo. Pode marcar a pessoa com @ ou informar o nome como aparece no WhatsApp?`);
 if(action.kind==='mention'&&!result.members.length)throw Error('GROUP_MEMBERS_UNAVAILABLE');
 const tags=result.members.map(p=>'@'+p.jid.split('@')[0]).join(' ');
 let text=action.kind==='introduction'?introductionText(tasksEnabled):replies.at(-1)??`${mentionToken}, podem ajudar com esta solicitação?`;
 if(action.kind==='mention'&&!text.includes(mentionToken)){
  const address=text.match(/^([^,!?:\n]{1,400})[,!?:]\s*/u);
  if(address){let rest=' '+clean(address[1])+' ';for(const name of action.names)rest=rest.replace(' '+clean(name)+' ',' ');if(!rest.trim()||rest.trim()==='e')text=text.slice(address[0].length);}
 }
 const content=text.includes(mentionToken)?text.replaceAll(mentionToken,tags):action.kind==='introduction'?text+(tags?'\n\n'+tags:''):tags+', '+text;
 return [...(action.kind==='mention'?replies.slice(0,-1):[]),{text:content,mentioned:result.members.map(p=>p.jid),recipients:action.kind==='mention'?result.members.map(p=>({jid:p.jid,aliases:p.aliases})):[]}];
}

// Revalidate persisted targets against fresh membership immediately before send.
export function textPayload(group,part,directory=null,quoted=null){
 const mentioned=JSON.parse(part.mentioned??'[]');
 if(mentioned.length&&(!directory||mentioned.some(id=>!directory.some(p=>p.aliases.includes(id)))))throw Error('GROUP_MEMBERS_CHANGED');
 return {number:group,text:part.text,linkPreview:false,...(mentioned.length?{mentioned}:{}),...(quoted?{quoted}: {})};
}

export async function loadGroupDirectory(evolution,config,profiles=[],botJid=''){
 if(!botJid)throw Error('BOT_IDENTITY_UNAVAILABLE');
 const path=encodeURIComponent(config.instance),group=encodeURIComponent(config.group_jid);
 const [data,contacts]=await Promise.all([
  evolution('/group/participants/'+path+'?groupJid='+group),
  evolution('/chat/findContacts/'+path,{method:'POST',body:JSON.stringify({where:{}})}),
 ]);
 if(!Array.isArray(contacts))throw Error('GROUP_CONTACTS_UNAVAILABLE');
 return groupDirectory(data.participants,contacts,profiles,botJid);
}
