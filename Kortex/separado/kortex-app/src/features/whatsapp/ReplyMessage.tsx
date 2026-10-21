import type { MouseEvent, ReactNode } from "react";

/** A separate keyboard target keeps links and media controls out of a nested button. */
export default function ReplyMessage({ label, onReply, className, children }: {
  label: string;
  onReply: () => void;
  className: string;
  children: ReactNode;
}) {
  const select = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("a, button, input, textarea, select, audio, video, [role='button'], [data-no-reply]")) return;
    if (window.getSelection()?.toString().trim()) return;
    onReply();
  };
  return (
    <div className={`inbox-message-bubble ${className}`} onClick={select}>
      <button
        type="button"
        className="inbox-message-reply-target"
        aria-label={label}
        onClick={onReply}
      />
      {children}
    </div>
  );
}
