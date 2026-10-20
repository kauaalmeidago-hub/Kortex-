import { useCallback, useEffect, useRef, useState } from "react";

/** Keep the controlled dialog mounted through its short exit and focus restoration. */
export function useChatDialog<T>(initial:T){
  const [value, setValue]=useState(initial), [open,setOpen]=useState(Boolean(initial));
  const closing=useRef<ReturnType<typeof setTimeout>>();
  const change=useCallback((next:T)=>{
    clearTimeout(closing.current);
    if(next){setValue(next);setOpen(true);}
    else {
      setOpen(false);
      const delay=typeof matchMedia==="function" && matchMedia("(prefers-reduced-motion: reduce)").matches?0:160;
      closing.current=setTimeout(()=>setValue(next),delay);
    }
  },[]);
  useEffect(()=>()=>clearTimeout(closing.current),[]);
  return [value,change,open] as const;
}
