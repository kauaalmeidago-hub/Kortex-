import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("@/services/automationApi", () => ({ downloadOperationArtifact: mock.download }));
import { KoaArtifactDownload } from "./KoaArtifactDownload";

describe("the saved card download action", () => {
  afterEach(() => { vi.resetAllMocks(); });
  it("lets the user retry a failed download without requesting another card", async () => {
    mock.download.mockRejectedValueOnce(new Error("Arquivo temporariamente indisponível.")).mockResolvedValueOnce(undefined);
    render(<KoaArtifactDownload operationId="operation-1" fileName="carteirinha.pdf" label="Baixar carteirinha" />);
    fireEvent.click(screen.getByRole("button", { name: "Baixar carteirinha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("temporariamente indisponível");
    fireEvent.click(screen.getByRole("button", { name: "Baixar carteirinha" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(mock.download).toHaveBeenCalledTimes(2);
    expect(mock.download).toHaveBeenLastCalledWith("operation-1", "carteirinha.pdf");
  });
});
