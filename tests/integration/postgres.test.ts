import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PostgresAccountingService } from "@/server/accounting/postgres";
import {
  PostgresPurchaseOrderSearch,
  PurchaseOrderSearchIndexer,
  PurchaseOrderSearchNotReadyError,
  type PurchaseOrderIndexResult,
} from "@/server/accounting/purchase-order-search";
import { createDatabase } from "@/server/db/client";
import { migrateDomainDatabase } from "@/server/db/migrate";
import {
  accountingInvoices,
  invoiceSubmissions,
  payments,
  purchaseOrderLines,
  purchaseOrderSearchDocuments,
  reconciliations,
} from "@/server/db/schema";
import {
  DEMO_IDS,
  seedDemoData,
  UNKNOWN_VENDOR_LOOKUP,
} from "@/server/db/seed";
import { setupDatabase } from "@/server/db/setup";
import type { ReconciliationJobPublisher } from "@/server/reconciliation/jobs";
import {
  ReconciliationRepository,
  ReconciliationReviewConflictError,
} from "@/server/reconciliation/repository";

const databaseUrl = process.env.DATABASE_URL;

const semanticConcepts = [
  /steel|fastener|glove|safety|hand protection|hardware/i,
  /document scanning|digitization|paperless/i,
  /desk chair|office seating/i,
  /shared number fixture|shared number/i,
  /shop towel|cleaning cloth/i,
  /copy paper|printer paper/i,
];

function semanticVector(text: string): number[] {
  const vector = Array.from({ length: 1536 }, () => 0);
  semanticConcepts.forEach((pattern, index) => {
    if (pattern.test(text)) vector[index] = 1;
  });
  const magnitude = Math.sqrt(
    vector.reduce((total, value) => total + value ** 2, 0),
  );
  if (magnitude === 0) vector[semanticConcepts.length] = 1;
  else vector.forEach((value, index) => (vector[index] = value / magnitude));
  return vector;
}

class TestEmbeddings implements EmbeddingsInterface {
  async embedDocuments(documents: string[]): Promise<number[][]> {
    return documents.map(semanticVector);
  }

  async embedQuery(query: string): Promise<number[]> {
    return semanticVector(query);
  }
}

describe.skipIf(!databaseUrl)("Postgres persistence", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = createDatabase(pool);
  const embeddings = new TestEmbeddings();
  const indexer = new PurchaseOrderSearchIndexer(db, embeddings);
  const semanticAccounting = new PostgresAccountingService(
    db,
    new PostgresPurchaseOrderSearch(db, () => embeddings),
  );
  let initialIndexResult: PurchaseOrderIndexResult;
  let originalSearchDocuments: (typeof purchaseOrderSearchDocuments.$inferSelect)[] =
    [];
  let searchProjectionPrepared = false;

  beforeAll(async () => {
    await setupDatabase(pool);
    await setupDatabase(pool);
    await migrateDomainDatabase(pool);
    await seedDemoData(db);
    await seedDemoData(db);
    originalSearchDocuments = await db
      .select()
      .from(purchaseOrderSearchDocuments);
    await db.delete(purchaseOrderSearchDocuments);
    searchProjectionPrepared = true;
    initialIndexResult = await indexer.indexAll();
  });

  afterAll(async () => {
    if (searchProjectionPrepared) {
      await db.delete(purchaseOrderSearchDocuments);
      if (originalSearchDocuments.length > 0) {
        await db
          .insert(purchaseOrderSearchDocuments)
          .values(originalSearchDocuments);
      }
    }
    await pool.end();
  });

  it("installs pgvector", async () => {
    const result = await pool.query<{ installed: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'vector'
      ) AS installed
    `);
    expect(result.rows[0]?.installed).toBe(true);
  });

  it("keeps reconciliation persistence to the narrow run index", async () => {
    const columns = await pool.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'reconciliations'
      ORDER BY ordinal_position
    `);
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      "id",
      "submission_id",
      "status",
      "failure_code",
      "failure_message",
      "started_at",
      "completed_at",
      "created_at",
      "updated_at",
    ]);

    const removedTables = await pool.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('reconciliation_reviews', 'reconciliation_events')
    `);
    expect(removedTables.rows).toEqual([]);
  });

  it("atomically accepts only one resume for a pending checkpoint review", async () => {
    const submissionId = crypto.randomUUID();
    const reconciliationId = crypto.randomUUID();
    const reviewId = crypto.randomUUID();
    await db.insert(invoiceSubmissions).values({
      id: submissionId,
      status: "received",
      receivedAt: new Date(),
    });
    await db.insert(reconciliations).values({
      id: reconciliationId,
      submissionId,
      status: "awaiting_payment_approval",
    });
    const enqueue = vi.fn().mockResolvedValue(crypto.randomUUID());
    const jobs = { enqueue } as unknown as ReconciliationJobPublisher;
    const repository = new ReconciliationRepository(db);
    const review = {
      reviewId,
      reconciliationId,
      kind: "payment" as const,
      title: "Approve payment",
      summary: "Ready",
      payload: {
        extraction: null,
        vendor: null,
        purchaseOrder: null,
        receivingRecords: [],
        lineMatches: [],
        discrepancies: [],
      },
    };
    const resolution = {
      decision: {
        reviewId,
        kind: "payment" as const,
        action: "approve_payment" as const,
      },
      reviewedBy: "integration-reviewer",
      decidedAt: "2026-07-21T18:00:00.000Z",
    };

    try {
      await repository.claimReviewAndEnqueue(
        {
          reconciliationId,
          checkpointId: "checkpoint-review",
          review,
          resolution,
        },
        jobs,
      );
      await expect(
        repository.claimReviewAndEnqueue(
          {
            reconciliationId,
            checkpointId: "checkpoint-review",
            review,
            resolution,
          },
          jobs,
        ),
      ).rejects.toBeInstanceOf(ReconciliationReviewConflictError);
      expect(enqueue).toHaveBeenCalledOnce();
    } finally {
      await db
        .delete(reconciliations)
        .where(eq(reconciliations.id, reconciliationId));
      await db
        .delete(invoiceSubmissions)
        .where(eq(invoiceSubmissions.id, submissionId));
    }
  });

  it("indexes seeded purchase orders idempotently", async () => {
    expect(initialIndexResult).toEqual({ total: 7, indexed: 7, skipped: 0 });
    await expect(indexer.indexAll()).resolves.toEqual({
      total: 7,
      indexed: 0,
      skipped: 7,
    });
  });

  it("loads the checked-in semantic index as part of the demo seed", () => {
    const demoPurchaseOrderIds = new Set<string>(
      Object.values(DEMO_IDS.purchaseOrders),
    );
    const seededDocuments = originalSearchDocuments.filter((document) =>
      demoPurchaseOrderIds.has(document.purchaseOrderId),
    );

    expect(seededDocuments).toHaveLength(7);
    expect(
      seededDocuments.every((document) => document.embedding.length === 1536),
    ).toBe(true);
    expect(
      seededDocuments.every(
        (document) => document.embeddingModel === "text-embedding-3-small",
      ),
    ).toBe(true);
  });

  it("ranks semantic PO candidates and hydrates their vendor and lines", async () => {
    const [safetyMatch] = await semanticAccounting.searchPurchaseOrders({
      query: "safety hand protection and steel hardware",
    });
    expect(safetyMatch).toMatchObject({
      purchaseOrder: {
        id: DEMO_IDS.purchaseOrders.fullyReceived,
        lines: [{ lineNumber: 1 }, { lineNumber: 2 }],
      },
      vendor: { id: DEMO_IDS.vendors.acme, displayName: "Acme Industrial" },
      similarity: 1,
    });

    const [scanningMatch] = await semanticAccounting.searchPurchaseOrders({
      query: "paperless document digitization services",
      limit: 1,
    });
    expect(scanningMatch?.purchaseOrder.id).toBe(
      DEMO_IDS.purchaseOrders.missingContact,
    );
  });

  it("applies relational filters before returning semantic candidates", async () => {
    const closedMatches = await semanticAccounting.searchPurchaseOrders({
      query: "office seating",
      statuses: ["closed"],
      currency: "usd",
      orderedFrom: "2026-05-01",
      orderedTo: "2026-05-31",
    });
    expect(closedMatches.map((match) => match.purchaseOrder.id)).toEqual([
      DEMO_IDS.purchaseOrders.closed,
    ]);

    const sharedMatches = await semanticAccounting.searchPurchaseOrders({
      query: "shared number",
      vendorId: DEMO_IDS.vendors.northstar,
      limit: 20,
    });
    expect(sharedMatches[0]?.purchaseOrder.id).toBe(
      DEMO_IDS.purchaseOrders.sharedNorthstar,
    );
    expect(
      sharedMatches.every(
        (match) => match.purchaseOrder.vendorId === DEMO_IDS.vendors.northstar,
      ),
    ).toBe(true);
  });

  it("reindexes only purchase orders whose canonical content changed", async () => {
    await db
      .update(purchaseOrderLines)
      .set({ description: "Industrial cleaning cloths", updatedAt: new Date() })
      .where(eq(purchaseOrderLines.id, DEMO_IDS.lines.partial));
    try {
      await expect(indexer.indexAll()).resolves.toEqual({
        total: 7,
        indexed: 1,
        skipped: 6,
      });
    } finally {
      await db
        .update(purchaseOrderLines)
        .set({ description: "Shop towels", updatedAt: new Date() })
        .where(eq(purchaseOrderLines.id, DEMO_IDS.lines.partial));
      await indexer.indexAll();
    }
  });

  it("fails explicitly when the semantic index is incomplete", async () => {
    await db
      .delete(purchaseOrderSearchDocuments)
      .where(
        eq(
          purchaseOrderSearchDocuments.purchaseOrderId,
          DEMO_IDS.purchaseOrders.noReceipts,
        ),
      );
    try {
      await expect(
        semanticAccounting.searchPurchaseOrders({ query: "printer paper" }),
      ).rejects.toMatchObject({
        name: PurchaseOrderSearchNotReadyError.name,
        indexedPurchaseOrders: 6,
        totalPurchaseOrders: 7,
      });
    } finally {
      await indexer.indexAll();
    }
  });

  it("finds vendors only by exact normalized business signals", async () => {
    const accounting = new PostgresAccountingService(createDatabase(pool));
    await expect(
      accounting.findVendorCandidates({ name: "Acme Supply" }),
    ).resolves.toMatchObject([
      { id: DEMO_IDS.vendors.acme, matchedOn: ["alias"] },
    ]);
    await expect(
      accounting.findVendorCandidates(UNKNOWN_VENDOR_LOOKUP),
    ).resolves.toEqual([]);
    await expect(
      accounting.findVendorCandidates({ name: "Acme Sup" }),
    ).resolves.toEqual([]);
  });

  it("returns found, ambiguous, and not-found purchase-order results", async () => {
    const accounting = new PostgresAccountingService(createDatabase(pool));
    const found = await accounting.findPurchaseOrder({ poNumber: "po-1001" });
    expect(found).toMatchObject({
      status: "found",
      value: {
        id: DEMO_IDS.purchaseOrders.fullyReceived,
        lines: [{ lineNumber: 1 }, { lineNumber: 2 }],
      },
    });
    await expect(
      accounting.findPurchaseOrder({ poNumber: "PO-SHARED" }),
    ).resolves.toMatchObject({
      status: "ambiguous",
      matches: [{}, {}],
    });
    await expect(
      accounting.findPurchaseOrder({ poNumber: "PO-UNKNOWN" }),
    ).resolves.toEqual({
      status: "not_found",
    });
  });

  it("represents full, partial, and absent receiving records", async () => {
    const accounting = new PostgresAccountingService(createDatabase(pool));
    const full = await accounting.getReceivingRecords(
      DEMO_IDS.purchaseOrders.fullyReceived,
    );
    expect(full[0]?.lines.map((line) => line.quantityReceived)).toEqual([
      "10.0000",
      "4.0000",
    ]);
    const partial = await accounting.getReceivingRecords(
      DEMO_IDS.purchaseOrders.partiallyReceived,
    );
    expect(partial[0]?.lines[0]?.quantityReceived).toBe("8.0000");
    await expect(
      accounting.getReceivingRecords(DEMO_IDS.purchaseOrders.noReceipts),
    ).resolves.toEqual([]);
    await expect(
      accounting.getVendor(DEMO_IDS.vendors.noContact),
    ).resolves.toMatchObject({
      apEmail: null,
    });
  });

  it("rechecks accounting state and remits idempotently", async () => {
    const accounting = new PostgresAccountingService(createDatabase(pool));
    const submissionId = crypto.randomUUID();
    const reconciliationId = crypto.randomUUID();
    const invoiceNumber = `INTEGRATION-${crypto.randomUUID()}`;
    await db.insert(invoiceSubmissions).values({
      id: submissionId,
      status: "received",
      receivedAt: new Date(),
    });
    await db.insert(reconciliations).values({
      id: reconciliationId,
      submissionId,
    });
    const input = {
      reconciliationId,
      idempotencyKey: reconciliationId,
      vendorId: DEMO_IDS.vendors.acme,
      purchaseOrderId: DEMO_IDS.purchaseOrders.fullyReceived,
      invoiceNumber,
      invoiceDate: "2026-07-20",
      dueDate: "2026-08-19",
      currency: "USD",
      amount: "5.2500",
      lines: [
        {
          sourceLineNumber: 1,
          purchaseOrderLineId: DEMO_IDS.lines.fullOne,
          description: "Steel fasteners",
          quantity: "1.0000",
          unitPrice: "5.2500",
          amount: "5.2500",
        },
      ],
    };
    try {
      await expect(
        accounting.remitPayment({
          ...input,
          lines: [{ ...input.lines[0]!, unitPrice: "5.2600" }],
        }),
      ).rejects.toMatchObject({ code: "purchase_order_changed" });

      const first = await accounting.remitPayment(input);
      const replay = await accounting.remitPayment(input);

      expect(replay).toEqual(first);
      await expect(
        accounting.getInvoice({
          vendorId: DEMO_IDS.vendors.acme,
          invoiceNumber,
        }),
      ).resolves.toMatchObject({ reconciliationId, amount: "5.2500" });
    } finally {
      await db
        .delete(payments)
        .where(eq(payments.reconciliationId, reconciliationId));
      await db
        .delete(accountingInvoices)
        .where(eq(accountingInvoices.reconciliationId, reconciliationId));
      await db
        .delete(reconciliations)
        .where(eq(reconciliations.id, reconciliationId));
      await db
        .delete(invoiceSubmissions)
        .where(eq(invoiceSubmissions.id, submissionId));
    }
  });
});
