import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completedTaskCycle, useTaskCycle } from "./useTaskCycle";
import type { TaskDraft, TaskMessage } from "@/integrations/supabase/taskTypes";
const at = Date.parse("2026-10-19T18:00:00Z");
const draft = (overrides: Partial<TaskDraft> = {}): TaskDraft => ({
  id: "draft",
  conversation_id: "conversation",
  workspace_id: "organization",
  created_by: "user",
  payload: {},
  version: 1,
  confirmed_version: 1,
  confirmed_task_id: "task",
  target_task_id: null,
  target_updated_at: null,
  created_at: new Date(at - 1000).toISOString(),
  updated_at: new Date(at).toISOString(),
  ...overrides,
});
const options = () => ({
  identity: "env:organization:user:conversation",
  drafts: [draft()],
  messages: [] as TaskMessage[],
  ready: true,
  blocked: false,
  hasError: false,
  activeWork: false,
});
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(at);
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("the completed operational cycle", () => {
  it("keeps the result at 59 seconds and returns at 60 without mutating records", () => {
    const p = options(),
      original = structuredClone(p);
    const { result } = renderHook(() => useTaskCycle(p));
    advance(59000);
    expect(result.current.initial).toBe(false);
    advance(1000);
    expect(result.current.initial).toBe(true);
    expect(p).toEqual(original);
  });
  it("never starts on initial access, a pending draft, or a partially confirmed batch", () => {
    for (const drafts of [
      [],
      [draft({ confirmed_task_id: null })],
      [draft(), draft({ id: "pending", confirmed_task_id: null })],
    ]) {
      const h = renderHook(() => useTaskCycle({ ...options(), drafts }));
      advance(61000);
      expect(h.result.current.initial).toBe(false);
      h.unmount();
    }
  });
  it("does not infer completion from an outdated version or a new unanswered request", () => {
    expect(
      completedTaskCycle([draft({ confirmed_version: 0 })], []),
    ).toBeNull();
    expect(
      completedTaskCycle(
        [draft()],
        [
          {
            role: "user",
            created_at: new Date(at + 1).toISOString(),
          } as TaskMessage,
        ],
      ),
    ).toBeNull();
  });
  it("does not reset the deadline or duplicate timers on rerenders", () => {
    const h = renderHook((p) => useTaskCycle(p), { initialProps: options() });
    for (let i = 0; i < 5; i++) {
      advance(10000);
      h.rerender({ ...options() });
      expect(vi.getTimerCount()).toBe(1);
    }
    advance(9999);
    expect(h.result.current.initial).toBe(false);
    advance(1);
    expect(h.result.current.initial).toBe(true);
  });
  it("typing at 59 seconds cancels the old return even after the text is cleared", () => {
    const h = renderHook(() => useTaskCycle(options()));
    advance(59000);
    act(() => h.result.current.interact());
    advance(100000);
    expect(h.result.current.initial).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("attachment activity cancels the return and survives a remount", () => {
    const h = renderHook(() => useTaskCycle(options()));
    advance(59000);
    act(() => h.result.current.interact());
    h.unmount();
    const next = renderHook(() =>
      useTaskCycle({ ...options(), activeWork: true }),
    );
    advance(61000);
    expect(next.result.current.initial).toBe(false);
  });
  it("suspends for an open review or sector dialog and resumes the original deadline", () => {
    const p = options(),
      h = renderHook((p) => useTaskCycle(p), { initialProps: p });
    advance(59000);
    h.rerender({ ...p, blocked: true });
    advance(5000);
    expect(h.result.current.initial).toBe(false);
    h.rerender({ ...p, blocked: false });
    advance(0);
    expect(h.result.current.initial).toBe(true);
  });
  it("a transient interaction closed before expiry does not restart another minute", () => {
    const p = options(),
      h = renderHook((p) => useTaskCycle(p), { initialProps: p });
    advance(20000);
    h.rerender({ ...p, blocked: true });
    advance(10000);
    h.rerender(p);
    advance(29999);
    expect(h.result.current.initial).toBe(false);
    advance(1);
    expect(h.result.current.initial).toBe(true);
  });
  it("never returns over an error or an in-flight operation", () => {
    for (const patch of [
      { hasError: true },
      { blocked: true },
      { ready: false },
    ]) {
      const h = renderHook(() => useTaskCycle({ ...options(), ...patch }));
      advance(61000);
      expect(h.result.current.initial).toBe(false);
      h.unmount();
    }
  });
  it("reconciles the server completion timestamp after reload", () => {
    const h = renderHook(() => useTaskCycle(options()));
    advance(59000);
    h.unmount();
    const next = renderHook(() => useTaskCycle(options()));
    advance(999);
    expect(next.result.current.initial).toBe(false);
    advance(1);
    expect(next.result.current.initial).toBe(true);
  });
  it("keeps a saved result hidden after return but opens the same history on demand", () => {
    const h = renderHook(() => useTaskCycle(options()));
    advance(60000);
    h.unmount();
    const next = renderHook(() => useTaskCycle(options()));
    expect(next.result.current.initial).toBe(true);
    act(() => next.result.current.interact(true));
    expect(next.result.current.initial).toBe(false);
  });
  it("cleans up on unmount and isolates user, organization and conversation", () => {
    const p = options(),
      h = renderHook((p) => useTaskCycle(p), { initialProps: p });
    advance(59000);
    h.rerender({ ...p, identity: "other:user:conversation", drafts: [] });
    advance(1000);
    expect(h.result.current.initial).toBe(false);
    h.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("invalidates an old callback when another cycle starts and schedules a fresh confirmed result", () => {
    const p = options(),
      h = renderHook((p) => useTaskCycle(p), { initialProps: p });
    advance(59000);
    h.rerender({
      ...p,
      drafts: [...p.drafts, draft({ id: "next", confirmed_task_id: null })],
    });
    advance(5000);
    expect(h.result.current.initial).toBe(false);
    const next = {
      ...p,
      drafts: [
        ...p.drafts,
        draft({ id: "next", updated_at: new Date(at + 64000).toISOString() }),
      ],
    };
    h.rerender(next);
    advance(59000);
    expect(h.result.current.initial).toBe(false);
    advance(1000);
    expect(h.result.current.initial).toBe(true);
  });
});

describe("persisted server cycle presentation",()=>{
 const server=(patch={})=>({...options(),drafts:[],serverCycle:{id:"current",conversation_id:"conversation",workspace_id:"organization",created_by:"user",state:"completed" as const,created_at:new Date(at-2000).toISOString(),completed_at:new Date(at).toISOString(),begin_key:"request",...patch}});
 it("uses the current completion at 59/60 seconds, independently of historical pending drafts",()=>{
  const h=renderHook(()=>useTaskCycle({...server(),drafts:[draft({cycle_id:"historical",confirmed_task_id:null})]}));advance(59000);expect(h.result.current.initial).toBe(false);advance(1000);expect(h.result.current.initial).toBe(true);
 });
 it("does not reopen a closed window when typing, consulting or sending another greeting",()=>{
  const h=renderHook(p=>useTaskCycle(p),{initialProps:server()});advance(60000);act(()=>h.result.current.interact(true));expect(h.result.current.initial).toBe(true);
  h.rerender(server({id:"next",state:"active",completed_at:null}));expect(h.result.current.initial).toBe(false);advance(120000);expect(h.result.current.initial).toBe(false);
 });
 it("hydrates an expired completed cycle synchronously without an old-result frame",()=>{
  const h=renderHook(()=>useTaskCycle(server()));h.unmount();vi.setSystemTime(at+65000);
  const frames:boolean[]=[];renderHook(()=>{const v=useTaskCycle(server());frames.push(v.initial);return v;});expect(frames.every(Boolean)).toBe(true);
 });
 it("ignores a delayed callback from an earlier cycle and preserves an active review",()=>{
  const h=renderHook(p=>useTaskCycle(p),{initialProps:server()});advance(59000);h.rerender(server({id:"new-cycle",state:"active",completed_at:null}));advance(2000);expect(h.result.current.initial).toBe(false);
 });
});
