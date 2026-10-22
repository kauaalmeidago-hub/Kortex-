import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Inbox} from './core.mjs';
import {ConversationScheduler} from './scheduler.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const gate=()=>Promise.withResolvers();
async function until(predicate) {
 const deadline=Date.now()+3000;
 while(!predicate()){if(Date.now()>deadline)assert.fail('condition did not complete');await tick();}
}
function insert(inbox,id,participant,group='a@g.us',received=1) {
 inbox.db.prepare('INSERT INTO inbox(id,group_jid,participant,text,ts,payload,received_at) VALUES(?,?,?,?,?,?,?)')
  .run(id,group,participant,'KOA, pode ajudar?',1,'{}',received);
}

test('a blocked participant does not hold another participant or another group; order and cap are preserved',async()=>{
 const inbox=new Inbox(':memory:'),blocked=gate(),started=[],completed=[];let peak=0,scheduler;
 try {
  insert(inbox,'a-first','a');insert(inbox,'a-next','a');insert(inbox,'b-first','b');insert(inbox,'other-group','a','b@g.us');
  scheduler=new ConversationScheduler({inbox,concurrency:2,process:async row=>{
   started.push(row.id);peak=Math.max(peak,scheduler.active.size);
   if(row.id==='a-first')await blocked.promise;
   inbox.finish(row.id,'sent');completed.push(row.id);
  }});
  scheduler.wake();await until(()=>completed.includes('other-group'));
  assert.deepEqual(started,['a-first','b-first','other-group']);
  assert.equal(completed.includes('a-first'),false);assert.equal(started.includes('a-next'),false);
  blocked.resolve();await until(()=>completed.length===4);
  assert.equal(started.at(-1),'a-next');assert.equal(peak,2);
 }finally{blocked.resolve();await scheduler?.stop();inbox.close();}
});

test('retries hold only their lane and multi-part replies finish before the next prompt',()=>{
 const inbox=new Inbox(':memory:');try {
  insert(inbox,'first','a');insert(inbox,'next','a');insert(inbox,'other','b');
  const first=inbox.claim(100);inbox.defer(first.id,'RATE_LIMIT',100);
  assert.equal(inbox.claim(100).id,'other');inbox.finish('other','ignored');assert.equal(inbox.claim(100),undefined);
  assert.equal(inbox.claim(16100).id,'first');inbox.plan('first',['one','two']);
  const part=inbox.nextPart('first');inbox.sending(part,16100);inbox.sent(part,'sent-one',16100);
  assert.equal(inbox.claim(16100,[first]),undefined);
  assert.equal(inbox.claim(16100).id,'first');
  const last=inbox.nextPart('first');inbox.sending(last,16100);inbox.sent(last,'sent-two',16100);
  assert.equal(inbox.claim(16100).id,'next');
 }finally{inbox.close();}
});

test('every freed slot immediately takes more work, including webhook wakes during an active request',async()=>{
 const inbox=new Inbox(':memory:'),slow=gate(),completed=[];let scheduler;
 try {
  insert(inbox,'slow','slow');
  scheduler=new ConversationScheduler({inbox,concurrency:8,process:async row=>{
   if(row.id==='slow')await slow.promise;
   inbox.finish(row.id,'sent');completed.push(row.id);
  }});
  scheduler.wake();await until(()=>scheduler.active.size===1);
  for(let i=0;i<80;i++)insert(inbox,'request-'+i,'person-'+i);
  for(let i=0;i<20;i++)scheduler.wake();
  await until(()=>completed.length===80);
  assert.equal(scheduler.active.size,1);assert.equal(inbox.stats().pending_count,0);
  slow.resolve();await until(()=>completed.length===81);
 }finally{slow.resolve();await scheduler?.stop();inbox.close();}
});

test('stop drains active work, leaves unclaimed requests durable and validates configuration',async()=>{
 const inbox=new Inbox(':memory:'),slow=gate();let scheduler;
 try {
  for(const concurrency of [0,33,NaN,1.5])assert.throws(()=>new ConversationScheduler({inbox,process:()=>{},concurrency}));
  insert(inbox,'running','a');insert(inbox,'queued','b');
  scheduler=new ConversationScheduler({inbox,concurrency:1,process:async row=>{await slow.promise;inbox.finish(row.id,'sent');}});
  scheduler.wake();await until(()=>scheduler.active.size===1);
  let stopped=false;const stopping=scheduler.stop().then(()=>{stopped=true;});
  await tick();assert.equal(stopped,false);
  slow.resolve();await stopping;
  assert.equal(inbox.db.prepare("SELECT state FROM inbox WHERE id='queued'").get().state,'pending');
 }finally{slow.resolve();await scheduler?.stop();inbox.close();}
});

test('reserved and uncertain sends consume rate slots before the transport finishes, scoped to their group',()=>{
 const inbox=new Inbox(':memory:');try {
  insert(inbox,'sending','a');inbox.claim(100);inbox.plan('sending',['one']);
  const part=inbox.nextPart('sending');inbox.sending(part,100);
  assert.equal(inbox.sendCounts('a@g.us','a',100).total,1);
  assert.equal(inbox.sendCounts('a@g.us','b',100).personal,0);
  assert.equal(inbox.sendCounts('b@g.us','a',100).total,0);
  inbox.uncertain(part);assert.equal(inbox.sendCounts('a@g.us','a',100).total,1);
  assert.equal(inbox.sendCounts('a@g.us','a',60101).total,0);
 }finally{inbox.close();}
});
