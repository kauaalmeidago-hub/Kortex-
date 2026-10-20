import { useCallback, useEffect, useRef, useState } from "react";
import type { TaskDraft, TaskMessage, TaskChatCycle } from "@/integrations/supabase/taskTypes";

export const TASK_RESULT_DELAY = 60000;
export function completedTaskCycle(
  drafts: TaskDraft[],
  messages: TaskMessage[],
) {
  if (
    !drafts.length ||
    drafts.some(
      (d) => !d.confirmed_task_id || d.confirmed_version !== d.version,
    )
  )
    return null;
  const at = Math.max(...drafts.map((d) => Date.parse(d.updated_at)));
  const lastRequest = Math.max(
    0,
    ...messages
      .filter((m) => m.role === "user")
      .map((m) => Date.parse(m.created_at)),
  );
  if (!Number.isFinite(at) || lastRequest > at) return null;
  return {
    at,
    id:
      drafts
        .map((d) => `${d.id}:${d.confirmed_version}`)
        .sort()
        .join("|") +
      ":" +
      at,
  };
}
type Presentation = {
  key: string;
  cycle: string;
  initial: boolean;
  cancelled: boolean;
};
function read(key: string): Presentation {
  try {
    const v = JSON.parse(sessionStorage.getItem(key) || "null");
    if (v?.key === key) return v;
  } catch {
    /* optional local presentation only */
  }
  return { key, cycle: "", initial: false, cancelled: false };
}
/** A deadline belongs to a confirmed cycle, never a render, token or task status. */
export function useTaskCycle({
  identity,
  drafts,
  messages,
  ready,
  blocked,
  hasError,
  activeWork = false,
  serverCycle,
}: {
  identity: string;
  drafts: TaskDraft[];
  messages: TaskMessage[];
  ready: boolean;
  blocked: boolean;
  hasError: boolean;
  activeWork?: boolean;
  serverCycle?: TaskChatCycle | null;
}) {
  const scoped = serverCycle !== undefined;
  const cycle = ready ? (scoped ? (serverCycle?.state === "completed" && serverCycle.completed_at ? {id:serverCycle.id,at:Date.parse(serverCycle.completed_at)} : null) : completedTaskCycle(drafts, messages)) : null;
  const cycleId = cycle?.id ?? "",
    completedAt = cycle?.at;
  const [state, setState] = useState(() => read(identity));
  // Resolve hydration synchronously: an expired window must never flash its records.
  const base = state.key === identity ? state : read(identity);
  const effective = cycleId && base.cycle !== cycleId
    ? {key:identity,cycle:cycleId,cancelled:activeWork,initial:!activeWork && !blocked && !hasError && Date.now() >= completedAt! + TASK_RESULT_DELAY}
    : base;
  const current = useRef({ identity, cycleId, blocked, hasError });
  current.current = { identity, cycleId, blocked, hasError };
  useEffect(() => {
    setState((previous) => {
      const base = previous.key === identity ? previous : read(identity);
      return cycleId && base.cycle !== cycleId
        ? {
            key: identity,
            cycle: cycleId,
            initial: !activeWork && !blocked && !hasError && Date.now() >= completedAt! + TASK_RESULT_DELAY,
            cancelled: activeWork,
          }
        : base;
    });
  }, [identity, cycleId, activeWork, blocked, hasError, completedAt]);
  useEffect(() => {
    if (state.key === identity)
      try {
        sessionStorage.setItem(identity, JSON.stringify(state));
      } catch {
        /* presentation is not authorization */
      }
  }, [state, identity]);
  useEffect(() => {
    if (
      !ready ||
      !cycleId ||
      completedAt === undefined ||
      state.key !== identity ||
      state.cycle !== cycleId ||
      state.cancelled ||
      state.initial ||
      blocked ||
      hasError
    )
      return;
    const timer = setTimeout(
      () => {
        const now = current.current;
        if (
          now.identity !== identity ||
          now.cycleId !== cycleId ||
          now.blocked ||
          now.hasError
        )
          return;
        setState((s) =>
          s.key === identity && s.cycle === cycleId && !s.cancelled
            ? { ...s, initial: true }
            : s,
        );
      },
      Math.max(0, completedAt + TASK_RESULT_DELAY - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [identity, cycleId, completedAt, ready, blocked, hasError, state]);
  const interact = useCallback(
    (showHistory = false) => {
      setState((s) => ({
        ...(s.key === identity ? s : read(identity)),
        cancelled: true,
        ...(!scoped && showHistory ? { initial: false } : {}),
      }));
    },
    [identity, scoped],
  );
  return {
    initial: scoped ? (!serverCycle || serverCycle.state === "historical" || (effective.cycle === cycleId && (effective.initial || (!effective.cancelled && ready && !blocked && !hasError && completedAt !== undefined && Date.now() >= completedAt + TASK_RESULT_DELAY)))) : state.key === identity && state.cycle === cycleId && state.initial,
    interact,
  };
}

