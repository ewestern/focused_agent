import { OpenAIEmbeddings } from "@langchain/openai";

export const PURCHASE_ORDER_EMBEDDING_MODEL = "text-embedding-3-small";
export const PURCHASE_ORDER_EMBEDDING_DIMENSIONS = 1536;

export class EmbeddingConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingConfigurationError";
  }
}

export function createPurchaseOrderEmbeddings(
  environment: { OPENAI_API_KEY: string | undefined } = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  },
): OpenAIEmbeddings {
  const apiKey = environment.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new EmbeddingConfigurationError(
      "OPENAI_API_KEY is required to index or semantically search purchase orders.",
    );
  }

  return new OpenAIEmbeddings({
    apiKey,
    model: PURCHASE_ORDER_EMBEDDING_MODEL,
    dimensions: PURCHASE_ORDER_EMBEDDING_DIMENSIONS,
  });
}
