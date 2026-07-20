import { and, eq } from "drizzle-orm";

import type { AppDatabase } from "@/server/db/client";
import {
  invoiceDocuments,
  invoiceSubmissions,
  reconciliations,
} from "@/server/db/schema";
import type { InvoiceSubmission } from "@/server/invoices/service";
import type { ReconciliationJobPublisher } from "@/server/reconciliation/jobs";
import type { ReconciliationPolicy } from "@/server/reconciliation/policy";

export type NewInvoiceDocumentRecord = {
  id: string;
  objectKey: string;
  originalFilename: string;
  contentType: string;
  byteSize: number;
  sha256: string;
};

export class InvoiceSubmissionRepository {
  constructor(private readonly db: AppDatabase) {}

  async findBySource(
    sourceKind: "manual",
    sourceExternalId: string,
  ): Promise<InvoiceSubmission | null> {
    const [row] = await this.db
      .select({ id: invoiceSubmissions.id })
      .from(invoiceSubmissions)
      .where(
        and(
          eq(invoiceSubmissions.sourceKind, sourceKind),
          eq(invoiceSubmissions.sourceExternalId, sourceExternalId),
        ),
      )
      .limit(1);
    if (!row) return null;
    const submission = await this.get(row.id);
    return submission;
  }

  async createReceiving(input: {
    id: string;
    sourceKind: "manual";
    sourceExternalId: string | null;
    documents: NewInvoiceDocumentRecord[];
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(invoiceSubmissions).values({
        id: input.id,
        sourceKind: input.sourceKind,
        sourceExternalId: input.sourceExternalId,
        status: "receiving",
      });
      await tx.insert(invoiceDocuments).values(
        input.documents.map((document) => ({
          ...document,
          submissionId: input.id,
        })),
      );
    });
  }

  async markReceivedAndEnqueue(
    id: string,
    policy: ReconciliationPolicy,
    jobs: ReconciliationJobPublisher,
  ): Promise<string> {
    return this.db.transaction(async (tx) => {
      await tx
        .update(invoiceSubmissions)
        .set({
          status: "received",
          receivedAt: new Date(),
          failureCode: null,
          failureMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(invoiceSubmissions.id, id));
      const existing = await tx
        .select({ id: reconciliations.id })
        .from(reconciliations)
        .where(eq(reconciliations.submissionId, id))
        .limit(1);
      if (existing[0]) return existing[0].id;
      const reconciliationId = crypto.randomUUID();
      await tx.insert(reconciliations).values({
        id: reconciliationId,
        submissionId: id,
        threadId: reconciliationId,
        effectivePolicy: policy,
      });
      await jobs.enqueue(tx, {
        reconciliationId,
        kind: "start",
      });
      return reconciliationId;
    });
  }

  async markFailed(id: string, code: string, message: string): Promise<void> {
    await this.db
      .update(invoiceSubmissions)
      .set({
        status: "failed",
        failureCode: code,
        failureMessage: message,
        updatedAt: new Date(),
      })
      .where(eq(invoiceSubmissions.id, id));
  }

  async get(id: string): Promise<InvoiceSubmission | null> {
    const [row] = await this.db
      .select()
      .from(invoiceSubmissions)
      .where(eq(invoiceSubmissions.id, id))
      .limit(1);
    if (!row) return null;
    const documents = await this.db
      .select()
      .from(invoiceDocuments)
      .where(eq(invoiceDocuments.submissionId, id));
    const [reconciliation] = await this.db
      .select({ id: reconciliations.id })
      .from(reconciliations)
      .where(eq(reconciliations.submissionId, id))
      .limit(1);
    return {
      id: row.id,
      sourceKind: row.sourceKind,
      sourceExternalId: row.sourceExternalId,
      status: row.status,
      failureCode: row.failureCode,
      failureMessage: row.failureMessage,
      receivedAt: row.receivedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      documents: documents.map((document) => ({
        id: document.id,
        originalFilename: document.originalFilename,
        contentType: document.contentType,
        byteSize: document.byteSize,
        sha256: document.sha256,
      })),
      reconciliationId: reconciliation?.id ?? null,
    };
  }

  async getForProcessing(id: string): Promise<{
    submission: InvoiceSubmission;
    documents: Array<{
      id: string;
      objectKey: string;
      originalFilename: string;
      contentType: string;
    }>;
  } | null> {
    const submission = await this.get(id);
    if (!submission) return null;
    const documents = await this.db
      .select({
        id: invoiceDocuments.id,
        objectKey: invoiceDocuments.objectKey,
        originalFilename: invoiceDocuments.originalFilename,
        contentType: invoiceDocuments.contentType,
      })
      .from(invoiceDocuments)
      .where(eq(invoiceDocuments.submissionId, id));
    return { submission, documents };
  }
}
