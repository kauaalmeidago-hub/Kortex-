export async function withRequestDeadline<T>(source:AbortSignal,work:(signal:AbortSignal)=>Promise<T>):Promise<T>{
  const controller=new AbortController();
  const cancel=()=>controller.abort();
  if(source.aborted)cancel();else source.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(cancel,10000);
  try{return await work(controller.signal);}finally{clearTimeout(timer);source.removeEventListener('abort',cancel);}
}
