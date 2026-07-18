import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { PGVectorStore } from "@langchain/pgvector";
import type { Pool } from "pg";

import type { Retriever } from "@/server/rag/retriever";

const VECTOR_STORE_CONFIG = {
  tableName: "rag_documents",
  collectionTableName: "rag_collections",
  collectionName: "default",
  columns: {
    idColumnName: "id",
    vectorColumnName: "embedding",
    contentColumnName: "content",
    metadataColumnName: "metadata",
  },
  distanceStrategy: "cosine" as const,
};

export async function createPgVectorRetriever(options: {
  embeddings: EmbeddingsInterface;
  pool: Pool;
}): Promise<Retriever> {
  const store = await PGVectorStore.initialize(options.embeddings, {
    ...VECTOR_STORE_CONFIG,
    pool: options.pool,
  });

  return {
    async retrieve(query, limit = 4) {
      const results = await store.similaritySearchWithScore(query, limit);
      return results.map(([document, score]) => ({
        id: document.id ?? "",
        content: document.pageContent,
        metadata: document.metadata,
        score,
      }));
    },
  };
}
