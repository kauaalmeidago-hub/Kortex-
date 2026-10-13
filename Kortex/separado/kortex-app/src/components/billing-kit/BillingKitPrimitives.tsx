import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronDown, X } from "lucide-react";
import { useRef, type ReactNode, type RefObject, type SelectHTMLAttributes } from "react";
import { Button } from "@/components/ui/button";
import { type BillingOperator } from "./billingKitData";

// A marca da operadora é a única exceção à paleta de componentes do Kortex.
export function OperatorLogo({ operator }: { operator: BillingOperator }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-sm text-foreground">
      {operator === "Hapvida" ? (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 shrink-0 text-[#ff6a00]">
          {[0, 60, 120, 180, 240, 300].map((angle) => (
            <rect key={angle} x="9.5" y="1" width="5" height="12" rx="2.5" fill="currentColor" transform={`rotate(${angle} 12 12)`} />
          ))}
        </svg>
      ) : (
        <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0076be] text-[11px] font-semibold text-white">N</span>
      )}
      {operator}
    </span>
  );
}

export function BillingSelect({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative min-w-0">
      <select {...props} className={`h-10 w-full appearance-none rounded-md border border-input bg-card px-3 pr-9 text-sm font-normal text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 ${className}`}>
        {children}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

export function BillingDialog({ open, onOpenChange, title, children, className = "", triggerRef }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  className?: string;
  triggerRef?: RefObject<HTMLElement>;
}) {
  const previousFocusRef = useRef<HTMLElement | null>(null);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/20 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:!animate-none" />
        <DialogPrimitive.Content aria-describedby={undefined} onOpenAutoFocus={() => { previousFocusRef.current = document.activeElement as HTMLElement; }} onCloseAutoFocus={(event) => { event.preventDefault(); const target = triggerRef?.current ?? previousFocusRef.current; if (target?.isConnected) target.focus(); }} className={`fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[640px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-card font-sans text-sm text-foreground shadow-xl outline-none ${className}`}>
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3">
            <DialogPrimitive.Title className="text-base font-semibold leading-6">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground" aria-label="Fechar">
                <X aria-hidden="true" />
              </Button>
            </DialogPrimitive.Close>
          </header>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
