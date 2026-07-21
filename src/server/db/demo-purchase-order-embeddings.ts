import { z } from "zod";

import artifactJson from "../../../fixtures/accounting/purchase-order-embeddings.json";
import {
  buildPurchaseOrderSearchDocument,
  type PurchaseOrderSearchDocument,
} from "@/server/accounting/purchase-order-search";
import {
  PURCHASE_ORDER_EMBEDDING_DIMENSIONS,
  PURCHASE_ORDER_EMBEDDING_MODEL,
} from "@/server/accounting/embeddings";
import { buildDemoPurchaseOrderSearchSources } from "@/server/db/demo-data";

export const DEMO_EMBEDDING_ARTIFACT_VERSION = 1;

const DemoPurchaseOrderEmbeddingArtifactSchema = z
  .object({
    formatVersion: z.literal(DEMO_EMBEDDING_ARTIFACT_VERSION),
    embeddingModel: z.literal(PURCHASE_ORDER_EMBEDDING_MODEL),
    embeddingDimensions: z.literal(PURCHASE_ORDER_EMBEDDING_DIMENSIONS),
    documents: z.array(
      z
        .object({
          purchaseOrderId: z.uuid(),
          content: z.string().min(1),
          contentHash: z.string().regex(/^[a-f0-9]{64}$/),
          embedding: z
            .array(z.number().finite())
            .length(PURCHASE_ORDER_EMBEDDING_DIMENSIONS),
        })
        .strict(),
    ),
  })
  .strict();

export type DemoPurchaseOrderEmbeddingArtifact = z.infer<
  typeof DemoPurchaseOrderEmbeddingArtifactSchema
>;

export class DemoPurchaseOrderEmbeddingArtifactError extends Error {
  constructor(message: string) {
    super(
      `${message} Regenerate the checked-in fixture with pnpm accounting:generate-seed-embeddings.`,
    );
    this.name = "DemoPurchaseOrderEmbeddingArtifactError";
  }
}

export function validateDemoPurchaseOrderEmbeddingArtifact(
  input: unknown,
): DemoPurchaseOrderEmbeddingArtifact {
  const parsed = DemoPurchaseOrderEmbeddingArtifactSchema.safeParse(input);
  if (!parsed.success) {
    throw new DemoPurchaseOrderEmbeddingArtifactError(
      `The demo purchase-order embedding artifact is invalid: ${z.prettifyError(parsed.error)}`,
    );
  }

  const canonicalDocuments = buildDemoPurchaseOrderSearchSources()
    .map(buildPurchaseOrderSearchDocument)
    .sort((left, right) =>
      left.purchaseOrderId.localeCompare(right.purchaseOrderId),
    );
  const artifactDocuments = [...parsed.data.documents].sort((left, right) =>
    left.purchaseOrderId.localeCompare(right.purchaseOrderId),
  );
  const uniqueIds = new Set(
    artifactDocuments.map((document) => document.purchaseOrderId),
  );

  if (uniqueIds.size !== artifactDocuments.length) {
    throw new DemoPurchaseOrderEmbeddingArtifactError(
      "The demo purchase-order embedding artifact contains duplicate purchase-order IDs.",
    );
  }
  if (artifactDocuments.length !== canonicalDocuments.length) {
    throw new DemoPurchaseOrderEmbeddingArtifactError(
      `The demo purchase-order embedding artifact contains ${artifactDocuments.length} documents; expected ${canonicalDocuments.length}.`,
    );
  }

  canonicalDocuments.forEach((canonical, index) => {
    const artifact = artifactDocuments[index];
    if (artifact?.purchaseOrderId !== canonical.purchaseOrderId) {
      throw new DemoPurchaseOrderEmbeddingArtifactError(
        `The demo purchase-order embedding artifact does not exactly cover purchase order ${canonical.purchaseOrderId}.`,
      );
    }
    if (
      artifact.content !== canonical.content ||
      artifact.contentHash !== canonical.contentHash
    ) {
      throw new DemoPurchaseOrderEmbeddingArtifactError(
        `The stored embedding content for purchase order ${canonical.purchaseOrderId} is stale.`,
      );
    }
  });

  return {
    ...parsed.data,
    documents: artifactDocuments,
  };
}

export type DemoPurchaseOrderSearchDocumentRow = PurchaseOrderSearchDocument & {
  embeddingModel: string;
  embeddingDimensions: number;
  embedding: number[];
};

export function getDemoPurchaseOrderSearchDocuments(
  input: unknown = artifactJson,
): DemoPurchaseOrderSearchDocumentRow[] {
  const artifact = validateDemoPurchaseOrderEmbeddingArtifact(input);
  return artifact.documents.map((document) => ({
    ...document,
    embeddingModel: artifact.embeddingModel,
    embeddingDimensions: artifact.embeddingDimensions,
  }));
}
