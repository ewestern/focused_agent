import { createHash } from "node:crypto";

import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import {
  and,
  asc,
  cosineDistance,
  count,
  eq,
  getTableColumns,
  gte,
  inArray,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";

import {
  createPurchaseOrderEmbeddings,
  PURCHASE_ORDER_EMBEDDING_DIMENSIONS,
  PURCHASE_ORDER_EMBEDDING_MODEL,
} from "@/server/accounting/embeddings";
import { mapPurchaseOrder, mapVendor } from "@/server/accounting/mappers";
import type {
  PurchaseOrder,
  PurchaseOrderSemanticMatch,
  PurchaseOrderSemanticQuery,
  Vendor,
} from "@/server/accounting/service";
import type { AppDatabase } from "@/server/db/client";
import {
  purchaseOrderLines,
  purchaseOrders,
  purchaseOrderSearchDocuments,
  vendorAliases,
  vendors,
} from "@/server/db/schema";

const PurchaseOrderSemanticQuerySchema = z
  .object({
    query: z.string().trim().min(1),
    limit: z.number().int().min(1).max(20).default(5),
    vendorId: z.uuid().optional(),
    statuses: z
      .array(z.enum(["open", "closed", "cancelled"]))
      .min(1)
      .optional(),
    currency: z
      .string()
      .trim()
      .length(3)
      .transform((value) => value.toUpperCase())
      .optional(),
    orderedFrom: z.iso.date().optional(),
    orderedTo: z.iso.date().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.orderedFrom &&
      value.orderedTo &&
      value.orderedFrom > value.orderedTo
    ) {
      context.addIssue({
        code: "custom",
        message: "orderedFrom must be on or before orderedTo.",
        path: ["orderedFrom"],
      });
    }
  });

export type PurchaseOrderSearchSource = {
  purchaseOrder: PurchaseOrder;
  vendor: Vendor;
  aliases: string[];
};

export type PurchaseOrderSearchDocument = {
  purchaseOrderId: string;
  content: string;
  contentHash: string;
};

export type PurchaseOrderIndexResult = {
  total: number;
  indexed: number;
  skipped: number;
};

export class PurchaseOrderSearchNotReadyError extends Error {
  constructor(
    readonly indexedPurchaseOrders: number,
    readonly totalPurchaseOrders: number,
  ) {
    super(
      `Purchase order semantic search is not ready: ${indexedPurchaseOrders} of ${totalPurchaseOrders} purchase orders are indexed for ${PURCHASE_ORDER_EMBEDDING_MODEL}.`,
    );
    this.name = "PurchaseOrderSearchNotReadyError";
  }
}

export class PurchaseOrderEmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurchaseOrderEmbeddingError";
  }
}

export function parsePurchaseOrderSemanticQuery(
  input: PurchaseOrderSemanticQuery,
): z.infer<typeof PurchaseOrderSemanticQuerySchema> {
  return PurchaseOrderSemanticQuerySchema.parse(input);
}

export function buildPurchaseOrderSearchDocument(
  source: PurchaseOrderSearchSource,
): PurchaseOrderSearchDocument {
  const aliases = [...source.aliases].sort((left, right) =>
    left.localeCompare(right),
  );
  const lines = [...source.purchaseOrder.lines].sort(
    (left, right) => left.lineNumber - right.lineNumber,
  );
  const content = [
    `Purchase order number: ${source.purchaseOrder.poNumber}`,
    `Vendor number: ${source.vendor.vendorNumber}`,
    `Vendor legal name: ${source.vendor.legalName}`,
    `Vendor display name: ${source.vendor.displayName}`,
    `Vendor aliases: ${aliases.length > 0 ? aliases.join(", ") : "none"}`,
    `Status: ${source.purchaseOrder.status}`,
    `Currency: ${source.purchaseOrder.currency}`,
    `Ordered date: ${source.purchaseOrder.orderedAt}`,
    `Closed date: ${source.purchaseOrder.closedAt ?? "none"}`,
    "Lines:",
    ...lines.map(
      (line) =>
        `Line ${line.lineNumber}: ${line.description}; quantity ${line.quantityOrdered}; unit price ${line.unitPrice} ${source.purchaseOrder.currency}`,
    ),
  ].join("\n");

  return {
    purchaseOrderId: source.purchaseOrder.id,
    content,
    contentHash: createHash("sha256").update(content, "utf8").digest("hex"),
  };
}

export function assertPurchaseOrderEmbedding(
  vector: number[],
  subject: string,
): void {
  if (vector.length !== PURCHASE_ORDER_EMBEDDING_DIMENSIONS) {
    throw new PurchaseOrderEmbeddingError(
      `${subject} embedding has ${vector.length} dimensions; expected ${PURCHASE_ORDER_EMBEDDING_DIMENSIONS}.`,
    );
  }
  if (vector.some((value) => !Number.isFinite(value))) {
    throw new PurchaseOrderEmbeddingError(
      `${subject} embedding contains a non-finite value.`,
    );
  }
}

async function loadPurchaseOrderSearchSources(
  db: AppDatabase,
): Promise<PurchaseOrderSearchSource[]> {
  const rows = await db
    .select({
      purchaseOrder: getTableColumns(purchaseOrders),
      vendor: getTableColumns(vendors),
    })
    .from(purchaseOrders)
    .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
    .orderBy(asc(purchaseOrders.id));
  if (rows.length === 0) return [];

  const orderIds = rows.map((row) => row.purchaseOrder.id);
  const vendorIds = [...new Set(rows.map((row) => row.vendor.id))];
  const [lineRows, aliasRows] = await Promise.all([
    db
      .select()
      .from(purchaseOrderLines)
      .where(inArray(purchaseOrderLines.purchaseOrderId, orderIds)),
    db
      .select({ vendorId: vendorAliases.vendorId, alias: vendorAliases.alias })
      .from(vendorAliases)
      .where(inArray(vendorAliases.vendorId, vendorIds)),
  ]);

  return rows.map(({ purchaseOrder, vendor }) => ({
    purchaseOrder: mapPurchaseOrder(purchaseOrder, lineRows),
    vendor: mapVendor(vendor),
    aliases: aliasRows
      .filter((alias) => alias.vendorId === vendor.id)
      .map((alias) => alias.alias),
  }));
}

export class PurchaseOrderSearchIndexer {
  constructor(
    private readonly db: AppDatabase,
    private readonly embeddings: EmbeddingsInterface,
  ) {}

  async indexAll(): Promise<PurchaseOrderIndexResult> {
    const sources = await loadPurchaseOrderSearchSources(this.db);
    const documents = sources.map(buildPurchaseOrderSearchDocument);
    const existingRows = await this.db
      .select({
        purchaseOrderId: purchaseOrderSearchDocuments.purchaseOrderId,
        contentHash: purchaseOrderSearchDocuments.contentHash,
        embeddingModel: purchaseOrderSearchDocuments.embeddingModel,
        embeddingDimensions: purchaseOrderSearchDocuments.embeddingDimensions,
      })
      .from(purchaseOrderSearchDocuments);
    const existingByPurchaseOrderId = new Map(
      existingRows.map((row) => [row.purchaseOrderId, row]),
    );
    const changedDocuments = documents.filter((document) => {
      const existing = existingByPurchaseOrderId.get(document.purchaseOrderId);
      return (
        !existing ||
        existing.contentHash !== document.contentHash ||
        existing.embeddingModel !== PURCHASE_ORDER_EMBEDDING_MODEL ||
        existing.embeddingDimensions !== PURCHASE_ORDER_EMBEDDING_DIMENSIONS
      );
    });

    if (changedDocuments.length === 0) {
      return { total: documents.length, indexed: 0, skipped: documents.length };
    }

    const vectors = await this.embeddings.embedDocuments(
      changedDocuments.map((document) => document.content),
    );
    if (vectors.length !== changedDocuments.length) {
      throw new PurchaseOrderEmbeddingError(
        `Embedding provider returned ${vectors.length} vectors for ${changedDocuments.length} purchase orders.`,
      );
    }
    vectors.forEach((vector, index) =>
      assertPurchaseOrderEmbedding(
        vector,
        `Purchase order ${changedDocuments[index].purchaseOrderId}`,
      ),
    );

    await this.db.transaction(async (transaction) => {
      for (const [index, document] of changedDocuments.entries()) {
        await transaction
          .insert(purchaseOrderSearchDocuments)
          .values({
            purchaseOrderId: document.purchaseOrderId,
            content: document.content,
            contentHash: document.contentHash,
            embeddingModel: PURCHASE_ORDER_EMBEDDING_MODEL,
            embeddingDimensions: PURCHASE_ORDER_EMBEDDING_DIMENSIONS,
            embedding: vectors[index],
            indexedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: purchaseOrderSearchDocuments.purchaseOrderId,
            set: {
              content: document.content,
              contentHash: document.contentHash,
              embeddingModel: PURCHASE_ORDER_EMBEDDING_MODEL,
              embeddingDimensions: PURCHASE_ORDER_EMBEDDING_DIMENSIONS,
              embedding: vectors[index],
              indexedAt: new Date(),
            },
          });
      }
    });

    return {
      total: documents.length,
      indexed: changedDocuments.length,
      skipped: documents.length - changedDocuments.length,
    };
  }
}

export class PostgresPurchaseOrderSearch {
  constructor(
    private readonly db: AppDatabase,
    private readonly embeddingsFactory: () => EmbeddingsInterface =
      createPurchaseOrderEmbeddings,
  ) {}

  async searchPurchaseOrders(
    input: PurchaseOrderSemanticQuery,
  ): Promise<PurchaseOrderSemanticMatch[]> {
    const query = parsePurchaseOrderSemanticQuery(input);
    const [{ totalPurchaseOrders }] = await this.db
      .select({ totalPurchaseOrders: count() })
      .from(purchaseOrders);
    if (totalPurchaseOrders === 0) return [];

    const [{ indexedPurchaseOrders }] = await this.db
      .select({ indexedPurchaseOrders: count() })
      .from(purchaseOrderSearchDocuments)
      .where(
        and(
          eq(
            purchaseOrderSearchDocuments.embeddingModel,
            PURCHASE_ORDER_EMBEDDING_MODEL,
          ),
          eq(
            purchaseOrderSearchDocuments.embeddingDimensions,
            PURCHASE_ORDER_EMBEDDING_DIMENSIONS,
          ),
        ),
      );
    if (indexedPurchaseOrders !== totalPurchaseOrders) {
      throw new PurchaseOrderSearchNotReadyError(
        indexedPurchaseOrders,
        totalPurchaseOrders,
      );
    }

    const queryEmbedding = await this.embeddingsFactory().embedQuery(query.query);
    assertPurchaseOrderEmbedding(queryEmbedding, "Query");
    const distance = cosineDistance(
      purchaseOrderSearchDocuments.embedding,
      queryEmbedding,
    );
    const conditions: SQL[] = [
      eq(
        purchaseOrderSearchDocuments.embeddingModel,
        PURCHASE_ORDER_EMBEDDING_MODEL,
      ),
      eq(
        purchaseOrderSearchDocuments.embeddingDimensions,
        PURCHASE_ORDER_EMBEDDING_DIMENSIONS,
      ),
    ];
    if (query.vendorId) conditions.push(eq(purchaseOrders.vendorId, query.vendorId));
    if (query.statuses) {
      conditions.push(inArray(purchaseOrders.status, query.statuses));
    }
    if (query.currency) conditions.push(eq(purchaseOrders.currency, query.currency));
    if (query.orderedFrom) {
      conditions.push(gte(purchaseOrders.orderedAt, query.orderedFrom));
    }
    if (query.orderedTo) {
      conditions.push(lte(purchaseOrders.orderedAt, query.orderedTo));
    }

    const matches = await this.db
      .select({
        purchaseOrder: getTableColumns(purchaseOrders),
        vendor: getTableColumns(vendors),
        similarity: sql<number>`1 - (${distance})`.mapWith(Number),
      })
      .from(purchaseOrderSearchDocuments)
      .innerJoin(
        purchaseOrders,
        eq(
          purchaseOrders.id,
          purchaseOrderSearchDocuments.purchaseOrderId,
        ),
      )
      .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
      .where(and(...conditions))
      .orderBy(asc(distance), asc(purchaseOrders.id))
      .limit(query.limit);
    if (matches.length === 0) return [];

    const lineRows = await this.db
      .select()
      .from(purchaseOrderLines)
      .where(
        inArray(
          purchaseOrderLines.purchaseOrderId,
          matches.map((match) => match.purchaseOrder.id),
        ),
      );
    return matches.map(({ purchaseOrder, vendor, similarity }) => ({
      purchaseOrder: mapPurchaseOrder(purchaseOrder, lineRows),
      vendor: mapVendor(vendor),
      similarity,
    }));
  }
}
