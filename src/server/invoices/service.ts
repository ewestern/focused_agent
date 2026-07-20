export type InvoiceSource = {
  kind: "manual";
  externalId?: string;
};

export type IncomingInvoiceDocument = {
  originalFilename: string;
  bytes: Uint8Array;
};

export type InvoiceDocument = {
  id: string;
  originalFilename: string;
  contentType: string;
  byteSize: number;
  sha256: string;
};

export type InvoiceSubmission = {
  id: string;
  sourceKind: "manual";
  sourceExternalId: string | null;
  status: "receiving" | "received" | "failed";
  failureCode: string | null;
  failureMessage: string | null;
  receivedAt: string | null;
  createdAt: string;
  documents: InvoiceDocument[];
  reconciliationId: string | null;
};

export interface InvoiceIngestionService {
  ingest(
    source: InvoiceSource,
    documents: IncomingInvoiceDocument[],
  ): Promise<InvoiceSubmission>;
  get(id: string): Promise<InvoiceSubmission | null>;
}
