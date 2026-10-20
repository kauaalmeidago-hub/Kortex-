import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

type PanelPhase = "closed" | "open" | "closing";

// Matches Conversations: .koa-panel-enter/.koa-panel-exit and sidebar events.
// Keep the mounted content and cancel the pending exit on a quick reopen.
export function useKoaSidePanel(
  triggerRef: RefObject<HTMLButtonElement>,
  focusRef: RefObject<HTMLInputElement>,
  escapeEnabled: boolean,
) {
  const [phase, setPhase] = useState<PanelPhase>("closed");
  const [hasOpened, setHasOpened] = useState(false);
  const phaseRef = useRef<PanelPhase>("closed");
  const announcedOpenRef = useRef(false);
  const closeTimerRef = useRef<number>();

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
  }, []);

  const open = useCallback(() => {
    clearCloseTimer();
    if (!announcedOpenRef.current) {
      window.dispatchEvent(new Event("kortex:koa-panel-open"));
      announcedOpenRef.current = true;
    }
    phaseRef.current = "open";
    setHasOpened(true);
    setPhase("open");
    focusRef.current?.focus();
  }, [clearCloseTimer, focusRef]);

  const finishClose = useCallback(() => {
    clearCloseTimer();
    phaseRef.current = "closed";
    setPhase("closed");
    if (announcedOpenRef.current) {
      window.dispatchEvent(new Event("kortex:koa-panel-close"));
      announcedOpenRef.current = false;
    }
  }, [clearCloseTimer]);

  const close = useCallback(() => {
    if (phaseRef.current !== "open") return;
    triggerRef.current?.focus();
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      finishClose();
      return;
    }
    phaseRef.current = "closing";
    setPhase("closing");
    closeTimerRef.current = window.setTimeout(finishClose, 220);
  }, [finishClose, triggerRef]);

  useEffect(() => {
    if (phase === "open") focusRef.current?.focus();
  }, [phase, focusRef]);

  useEffect(() => {
    if (phase !== "open" || !escapeEnabled) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Radix selections/dialogs own the first Escape while they are open.
      if (
        document.querySelector(
          '[data-state="open"][role="dialog"], [data-state="open"][role="listbox"], [data-state="open"][role="menu"]',
        )
      )
        return;
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [phase, escapeEnabled, close]);

  useEffect(
    () => () => {
      clearCloseTimer();
      if (announcedOpenRef.current) {
        window.dispatchEvent(new Event("kortex:koa-panel-close"));
        announcedOpenRef.current = false;
      }
    },
    [clearCloseTimer],
  );

  return { phase, hasOpened, visible: phase !== "closed", open, close };
}
