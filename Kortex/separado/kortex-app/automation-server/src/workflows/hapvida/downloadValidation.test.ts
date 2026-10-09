import { describe, expect, it } from "vitest";
import { validateCardPdfBytes } from "./downloadValidation.js";

const complete = "%PDF-1.7\n1 0 obj << /Type /Page >> endobj\n%%EOF\n";

describe("card PDF completion", () => {
  it.each([complete, complete + "\r\n \t", complete + "2 0 obj << /Type /Page >> endobj\n%%EOF\n"])
    ("accepts a completed file, including trailing whitespace and a completed revision", text => {
      const bytes = Buffer.from(text);
      expect(validateCardPdfBytes(bytes)).toBe(bytes);
    });

  it.each([
    "",
    "<!doctype html><html>Sessao expirada</html>",
    "%PDF-1.7\n%%EOF\n",
    complete.replace("%%EOF\n", ""),
    complete.replace("%%EOF\n", "%%EO"),
    complete + "2 0 obj << /Type /Page >> endobj\n",
    complete + "resposta incompleta",
  ])("rejects an empty, non-PDF, pageless or interrupted file", text => {
    expect(() => validateCardPdfBytes(Buffer.from(text))).toThrowError(expect.objectContaining({ code: "PDF_VALIDATION_FAILED" }));
  });
});
