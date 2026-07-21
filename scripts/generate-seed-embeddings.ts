import "dotenv/config";

import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { EmbeddingsInterface } from "@langchain/core/embeddings";

import {
  createPurchaseOrderEmbeddings,
  PURCHASE_ORDER_EMBEDDING_DIMENSIONS,
  PURCHASE_ORDER_EMBEDDING_MODEL,
} from "../src/server/accounting/embeddings";
import {
  assertPurchaseOrderEmbedding,
  buildPurchaseOrderSearchDocument,
} from "../src/server/accounting/purchase-order-search";
import { buildDemoPurchaseOrderSearchSources } from "../src/server/db/demo-data";
import { validateDemoPurchaseOrderEmbeddingArtifact } from "../src/server/db/demo-purchase-order-embeddings";

const DEMO_EMBEDDING_ARTIFACT_VERSION = 1;

export type GeneratedDemoPurchaseOrderEmbeddingArtifact = {
  formatVersion: typeof DEMO_EMBEDDING_ARTIFACT_VERSION;
  embeddingModel: string;
  embeddingDimensions: number;
  documents: Array<{
    purchaseOrderId: string;
    content: string;
    contentHash: string;
    embedding: number[];
  }>;
};

export const DEMO_EMBEDDING_ARTIFACT_PATH = path.resolve(
  "fixtures/accounting/purchase-order-embeddings.json",
);

export async function generateDemoPurchaseOrderEmbeddingArtifact(
  embeddings: EmbeddingsInterface,
): Promise<GeneratedDemoPurchaseOrderEmbeddingArtifact> {
  const documents = buildDemoPurchaseOrderSearchSources()
    .map(buildPurchaseOrderSearchDocument)
    .sort((left, right) =>
      left.purchaseOrderId.localeCompare(right.purchaseOrderId),
    );
  const vectors = await embeddings.embedDocuments(
    documents.map((document) => document.content),
  );
  if (vectors.length !== documents.length) {
    throw new Error(
      `Embedding provider returned ${vectors.length} vectors for ${documents.length} demo purchase orders.`,
    );
  }
  vectors.forEach((vector, index) =>
    assertPurchaseOrderEmbedding(
      vector,
      `Purchase order ${documents[index].purchaseOrderId}`,
    ),
  );

  return validateDemoPurchaseOrderEmbeddingArtifact({
    formatVersion: DEMO_EMBEDDING_ARTIFACT_VERSION,
    embeddingModel: PURCHASE_ORDER_EMBEDDING_MODEL,
    embeddingDimensions: PURCHASE_ORDER_EMBEDDING_DIMENSIONS,
    documents: documents.map((document, index) => ({
      ...document,
      embedding: vectors[index],
    })),
  });
}

async function main(): Promise<void> {
  const artifact = await generateDemoPurchaseOrderEmbeddingArtifact(
    createPurchaseOrderEmbeddings(),
  );
  await mkdir(path.dirname(DEMO_EMBEDDING_ARTIFACT_PATH), { recursive: true });
  const temporaryPath = `${DEMO_EMBEDDING_ARTIFACT_PATH}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await rename(temporaryPath, DEMO_EMBEDDING_ARTIFACT_PATH);
  console.log(
    `Wrote ${artifact.documents.length} pre-generated purchase-order embeddings to ${path.relative(process.cwd(), DEMO_EMBEDDING_ARTIFACT_PATH)}.`,
  );
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  void main().catch((error: unknown) => {
    console.error("Demo purchase-order embedding generation failed.", error);
    process.exitCode = 1;
  });
}
