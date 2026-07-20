import { describe, expect, it, vi } from "vitest";

import type { DocumentStore } from "@/server/documents/store";
import { PostgresInvoiceIngestionService, InvoiceStorageError } from "@/server/invoices/ingestion";
import type { InvoiceSubmissionRepository } from "@/server/invoices/postgres-repository";
import type { ReconciliationJobPublisher } from "@/server/reconciliation/jobs";

describe("invoice ingestion", () => {
  it("records a failed submission and removes stored objects when storage fails", async () => {
    const repository = {
      findBySource: vi.fn(),
      createReceiving: vi.fn(),
      markReceivedAndEnqueue: vi.fn(),
      markFailed: vi.fn(),
      get: vi.fn(),
    } as unknown as InvoiceSubmissionRepository;
    const store = {
      put: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("offline")),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as DocumentStore;
    const jobs = { enqueue: vi.fn() } as unknown as ReconciliationJobPublisher;
    const service = new PostgresInvoiceIngestionService(repository, store, jobs);
    const pdf = new TextEncoder().encode("%PDF-1.4\n");

    await expect(
      service.ingest(
        { kind: "manual" },
        [
          { originalFilename: "one.pdf", bytes: pdf },
          { originalFilename: "two.pdf", bytes: pdf },
        ],
      ),
    ).rejects.toBeInstanceOf(InvoiceStorageError);
    expect(repository.markFailed).toHaveBeenCalledWith(
      expect.any(String),
      "document_storage_failed",
      "offline",
    );
    expect(store.delete).toHaveBeenCalledTimes(1);
    expect(repository.markReceivedAndEnqueue).not.toHaveBeenCalled();
  });
});
