import { createHash } from "node:crypto";

import { getDatabase } from "@/server/db/client";
import { getDocumentStore } from "@/server/documents/s3";
import type { DocumentStore } from "@/server/documents/store";
import { InvoiceSubmissionRepository } from "@/server/invoices/postgres-repository";
import type {
  IncomingInvoiceDocument,
  InvoiceIngestionService,
  InvoiceSource,
  InvoiceSubmission,
} from "@/server/invoices/service";
import { validateInvoiceDocument } from "@/server/invoices/validation";
import {
  getReconciliationJobPublisher,
  type ReconciliationJobPublisher,
} from "@/server/reconciliation/jobs";
import { DEFAULT_RECONCILIATION_POLICY } from "@/server/reconciliation/policy";

export class InvoiceStorageError extends Error {
  constructor(public readonly submissionId: string) {
    super("The invoice document could not be stored.");
    this.name = "InvoiceStorageError";
  }
}

export class PostgresInvoiceIngestionService implements InvoiceIngestionService {
  constructor(
    private readonly repository: InvoiceSubmissionRepository,
    private readonly documentStore: DocumentStore,
    private readonly jobs: ReconciliationJobPublisher,
  ) {}

  async ingest(
    source: InvoiceSource,
    documents: IncomingInvoiceDocument[],
  ): Promise<InvoiceSubmission> {
    if (documents.length === 0) {
      throw new Error("At least one invoice document is required.");
    }
    if (source.externalId) {
      const existing = await this.repository.findBySource(source.kind, source.externalId);
      if (existing) return existing;
    }

    const submissionId = crypto.randomUUID();
    const preparedDocuments = await Promise.all(
      documents.map(async (document) => {
        const { contentType } = await validateInvoiceDocument(document.bytes);
        const id = crypto.randomUUID();
        return {
          ...document,
          id,
          contentType,
          byteSize: document.bytes.byteLength,
          sha256: createHash("sha256").update(document.bytes).digest("hex"),
          objectKey: `invoice-submissions/${submissionId}/documents/${id}`,
        };
      }),
    );

    await this.repository.createReceiving({
      id: submissionId,
      sourceKind: source.kind,
      sourceExternalId: source.externalId ?? null,
      documents: preparedDocuments.map((document) => ({
        id: document.id,
        objectKey: document.objectKey,
        originalFilename: document.originalFilename,
        contentType: document.contentType,
        byteSize: document.byteSize,
        sha256: document.sha256,
      })),
    });

    const storedKeys: string[] = [];
    try {
      for (const document of preparedDocuments) {
        await this.documentStore.put({
          key: document.objectKey,
          body: document.bytes,
          contentType: document.contentType,
          sha256: document.sha256,
        });
        storedKeys.push(document.objectKey);
      }
      await this.repository.markReceivedAndEnqueue(
        submissionId,
        DEFAULT_RECONCILIATION_POLICY,
        this.jobs,
      );
    } catch (error) {
      await Promise.allSettled(storedKeys.map((key) => this.documentStore.delete(key)));
      const message = error instanceof Error ? error.message : "Unknown storage error";
      await this.repository.markFailed(submissionId, "document_storage_failed", message);
      throw new InvoiceStorageError(submissionId);
    }

    const submission = await this.repository.get(submissionId);
    if (!submission) throw new Error("Created invoice submission could not be loaded.");
    return submission;
  }

  get(id: string): Promise<InvoiceSubmission | null> {
    return this.repository.get(id);
  }
}

let sharedServicePromise: Promise<PostgresInvoiceIngestionService> | undefined;

export async function getInvoiceIngestionService(): Promise<PostgresInvoiceIngestionService> {
  sharedServicePromise ??= getReconciliationJobPublisher().then(
    (jobs) =>
      new PostgresInvoiceIngestionService(
        new InvoiceSubmissionRepository(getDatabase()),
        getDocumentStore(),
        jobs,
      ),
  );
  try {
    return await sharedServicePromise;
  } catch (error) {
    sharedServicePromise = undefined;
    throw error;
  }
}
