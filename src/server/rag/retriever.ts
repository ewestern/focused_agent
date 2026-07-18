export type RetrievedDocument = {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  score?: number;
};

export interface Retriever {
  retrieve(query: string, limit?: number): Promise<RetrievedDocument[]>;
}
