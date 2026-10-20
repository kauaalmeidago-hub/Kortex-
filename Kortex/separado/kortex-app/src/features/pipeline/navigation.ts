// UI navigation state only; records and permissions always come from the server.
const positions = new Map<string, { left: number; top: number }>();
export const pipelinePosition = (key: string) => positions.get(key) ?? { left: 0, top: 0 };
export function savePipelinePosition(key: string, left: number, top: number) {
  positions.set(key, { left, top });
  if (positions.size > 50) positions.delete(positions.keys().next().value!);
}
export const recordHref = (id: string, returnTo?: string) =>
  `/leads/${encodeURIComponent(id)}${returnTo ? `?return=${encodeURIComponent(returnTo)}` : ""}`;
export function pipelineReturn(value: string | null, pipelineId?: string | null) {
  return value && /^\/pipeline(?:\/[0-9a-f-]{36})?(?:\?[^#]*)?$/i.test(value)
    ? value : pipelineId ? `/pipeline/${pipelineId}` : "/pipeline";
}
