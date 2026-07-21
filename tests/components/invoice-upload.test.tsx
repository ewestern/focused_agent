// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InvoiceUpload } from "@/components/invoice-upload";

describe("invoice upload", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the received submission after upload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            submission: {
              id: "00000000-0000-4000-8000-000000009999",
              status: "received",
              failureCode: null,
              failureMessage: null,
              receivedAt: "2026-07-20T18:00:00.000Z",
              createdAt: "2026-07-20T18:00:00.000Z",
              reconciliationId: "00000000-0000-4000-8000-000000009997",
              documents: [
                {
                  id: "00000000-0000-4000-8000-000000009998",
                  originalFilename: "invoice.pdf",
                  contentType: "application/pdf",
                  byteSize: 9,
                  sha256: "a".repeat(64),
                },
              ],
            },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const user = userEvent.setup();
    render(<InvoiceUpload />);

    await user.upload(
      screen.getByLabelText(/Invoice document/),
      new File(["%PDF-1.4"], "invoice.pdf", { type: "application/pdf" }),
    );
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Upload and reconcile" })
        .closest("form")!,
    );

    expect(fetch).toHaveBeenCalledWith(
      "/api/invoice-submissions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(await screen.findByText("Received")).toBeInTheDocument();
    expect(screen.getByText("queued")).toBeInTheDocument();
    expect(screen.getByText("invoice.pdf")).toBeInTheDocument();
  });
});
