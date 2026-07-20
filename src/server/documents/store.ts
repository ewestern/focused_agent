export type StoredDocumentMetadata = {
  contentLength: number | undefined;
  contentType: string | undefined;
  sha256: string | undefined;
};

export type PutDocument = {
  key: string;
  body: Uint8Array;
  contentType: string;
  sha256: string;
};

export interface DocumentStore {
  put(document: PutDocument): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  head(key: string): Promise<StoredDocumentMetadata | null>;
  delete(key: string): Promise<void>;
  ensureReady(): Promise<void>;
  isHealthy(): Promise<boolean>;
}
