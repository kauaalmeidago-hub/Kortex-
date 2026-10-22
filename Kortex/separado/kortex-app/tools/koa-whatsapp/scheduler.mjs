// One process owns the SQLite inbox. Async IO may run concurrently; claims and
// delivery reservations stay synchronous so the same work cannot be sent twice.
export class ConversationScheduler {
 constructor({inbox,process,concurrency=8,onError=()=>{},now=Date.now}) {
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>32)throw Error('INVALID_KOA_CONCURRENCY');
  Object.assign(this,{inbox,process,concurrency,onError,now});
  this.active=new Map();this.scheduled=false;this.stopping=false;this.waiters=[];
 }
 wake() {
  if(this.stopping||this.scheduled)return;
  this.scheduled=true;
  setImmediate(()=>{this.scheduled=false;this.pump();});
 }
 pump() {
  if(this.stopping)return;
  while(this.active.size<this.concurrency) {
   const row=this.inbox.claim(this.now(),[...this.active.values()]);
   if(!row)break;
   this.active.set(row.id,row);
   Promise.resolve().then(()=>this.process(row)).catch(error=>this.onError(error,row)).finally(()=>{
    this.active.delete(row.id);
    if(!this.active.size)for(const resolve of this.waiters.splice(0))resolve();
    this.wake();
   });
  }
 }
 async stop() {
  this.stopping=true;
  if(this.active.size)await new Promise(resolve=>this.waiters.push(resolve));
 }
}
