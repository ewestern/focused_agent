import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { describe, expect, it } from "vitest";

import artifactJson from "../../fixtures/accounting/purchase-order-embeddings.json";
import { PURCHASE_ORDER_EMBEDDING_DIMENSIONS } from "@/server/accounting/embeddings";
import {
  DemoPurchaseOrderEmbeddingArtifactError,
  getDemoPurchaseOrderSearchDocuments,
  validateDemoPurchaseOrderEmbeddingArtifact,
} from "@/server/db/demo-purchase-order-embeddings";
import { DEMO_PURCHASE_ORDERS } from "@/server/db/demo-data";
import { generateDemoPurchaseOrderEmbeddingArtifact } from "../../scripts/generate-seed-embeddings";

class TestEmbeddings implements EmbeddingsInterface {
  async embedDocuments(documents: string[]): Promise<number[][]> {
    return documents.map((_document, documentIndex) =>
      Array.from(
        { length: PURCHASE_ORDER_EMBEDDING_DIMENSIONS },
        (_value, dimensionIndex) => (dimensionIndex === documentIndex ? 1 : 0),
      ),
    );
  }

  async embedQuery(): Promise<number[]> {
    throw new Error("Not used by seed generation.");
  }
}

describe("demo purchase-order embedding artifact", () => {
  it("is complete, canonical, and ready for direct database seeding", () => {
    const documents = getDemoPurchaseOrderSearchDocuments();

    expect(documents).toHaveLength(DEMO_PURCHASE_ORDERS.length);
    expect(documents.map((document) => document.purchaseOrderId)).toEqual(
      DEMO_PURCHASE_ORDERS.map((order) => order.id).sort(),
    );
    expect(
      documents.every(
        (document) =>
          document.embedding.length === PURCHASE_ORDER_EMBEDDING_DIMENSIONS &&
          document.embedding.every(Number.isFinite),
      ),
    ).toBe(true);
  });

  it("rejects a fixture whose embedded content no longer matches the seed", () => {
    const staleArtifact = structuredClone(artifactJson);
    staleArtifact.documents[0].content = `${staleArtifact.documents[0].content}\nStale change`;

    expect(() =>
      validateDemoPurchaseOrderEmbeddingArtifact(staleArtifact),
    ).toThrow(DemoPurchaseOrderEmbeddingArtifactError);
    expect(() =>
      validateDemoPurchaseOrderEmbeddingArtifact(staleArtifact),
    ).toThrow("accounting:generate-seed-embeddings");
  });

  it("generates documents in stable order with an injected embedding provider", async () => {
    const artifact = await generateDemoPurchaseOrderEmbeddingArtifact(
      new TestEmbeddings(),
    );

    expect(
      artifact.documents.map((document) => document.purchaseOrderId),
    ).toEqual(DEMO_PURCHASE_ORDERS.map((order) => order.id).sort());
    expect(artifact.documents[0].embedding[0]).toBe(1);
    expect(artifact.documents[1].embedding[1]).toBe(1);
  });
});
