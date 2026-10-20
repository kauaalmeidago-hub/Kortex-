import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import * as Primitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { DialogPortal, DialogOverlay } from "@/components/ui/dialog";

/** Scoped to this chat: other platform dialogs keep their existing motion. */
export const TaskChatDialogContent = forwardRef<ElementRef<typeof Primitive.Content>, ComponentPropsWithoutRef<typeof Primitive.Content>>(({className="",children,...props},ref)=>(
  <DialogPortal>
    <DialogOverlay className="task-admin-overlay" />
    <Primitive.Content ref={ref} className={`fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 border bg-background p-6 shadow-lg sm:rounded-lg task-admin-modal ${className}`} {...props}>
      {children}
      <Primitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><X size={16}/><span className="sr-only">Fechar</span></Primitive.Close>
    </Primitive.Content>
  </DialogPortal>
));
TaskChatDialogContent.displayName="TaskChatDialogContent";
