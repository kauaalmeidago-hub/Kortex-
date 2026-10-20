import { describe, expect, it } from "vitest";
import { pipelineReturn, recordHref } from "./navigation";
describe("pipeline return destination", () => {
  const id="00000000-0000-4000-8000-000000000010";
  it("keeps the original authorized pipeline and its URL filters", () => {
    const back=`/pipeline/${id}?view=list&q=Empresa%20A&date=dated`;
    const link=new URL(recordHref("record",back),"https://example.invalid");
    expect(pipelineReturn(link.searchParams.get("return"),id)).toBe(back);
  });
  it("rejects external and unrelated destinations", () => {
    for(const url of ["https://example.invalid","//example.invalid","/companies","/pipeline/../../auth"])
      expect(pipelineReturn(url,id)).toBe(`/pipeline/${id}`);
  });
});
