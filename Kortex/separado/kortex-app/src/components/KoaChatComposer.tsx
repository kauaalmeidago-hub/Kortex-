import { useEffect, useRef, type Ref } from "react";
import { Paperclip, ArrowUp, Loader2 } from "lucide-react";

// The message input used by Conversations and the specialized billing panel.
export default function KoaChatComposer({
  value,
  onChange,
  onSubmit,
  disabled = false,
  inputRef,
  inputLabel,
  attachmentDisabled = false,
  attachmentTitle,
  multiline = false,
  onAttach,
  multilineRows = 2,
  allowEmpty = false,
  submitting = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  inputLabel?: string;
  attachmentDisabled?: boolean;
  attachmentTitle?: string;
  multiline?: boolean;
  onAttach?: () => void;
  multilineRows?: number;
  allowEmpty?: boolean;
  submitting?: boolean;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (textarea.current) {
      textarea.current.style.height = "auto";
      textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 144)}px`;
    }
  }, [value]);
  if (multiline)
    return (
      <div className="task-chat-composer">
        <textarea
          ref={textarea}
          aria-label={inputLabel || "Mensagem para o KOA"}
          placeholder="Digite uma mensagem..."
          value={value}
          maxLength={16000}
          rows={multilineRows}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              if (!disabled && (value.trim() || allowEmpty)) onSubmit();
            }
          }}
        />
        <div>
          <button
            type="button"
            aria-label="Anexar arquivo"
            title={attachmentTitle}
            onClick={onAttach}
            disabled={attachmentDisabled || !onAttach}
          >
            <Paperclip size={19} />
          </button>
          <button
            type="button"
            className="koa-chat-send"
            aria-label="Enviar"
            disabled={disabled || (!value.trim() && !allowEmpty)}
            onClick={onSubmit}
          >
            {submitting ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <ArrowUp size={20} />
            )}
          </button>
        </div>
      </div>
    );
  return (
    <div className="shrink-0 border-t border-border bg-card px-4 py-3">
      <div className="flex min-w-0 items-center gap-2 rounded-full bg-secondary/70 px-3 py-2">
        <input
          ref={inputRef}
          aria-label={inputLabel}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!disabled) onSubmit();
            }
          }}
          className="h-10 min-w-0 flex-1 bg-transparent px-2 text-sm font-normal outline-none placeholder:text-muted-foreground"
          placeholder="Digite uma mensagem..."
        />
        <button
          type="button"
          disabled={attachmentDisabled || !onAttach}
          onClick={onAttach}
          title={attachmentTitle}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-background hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
          aria-label="Anexar arquivo"
        >
          <Paperclip className="h-5 w-5" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled}
          className="koa-chat-send flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-55"
        >
          <ArrowUp className="h-5 w-5" strokeWidth={1.5} />
          <span className="sr-only">Enviar</span>
        </button>
      </div>
    </div>
  );
}
