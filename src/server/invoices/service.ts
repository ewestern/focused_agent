import type { InvoiceSubmission } from "@/lib/contracts";

export type IncomingInvoiceDocument = {
  originalFilename: string;
  bytes: Uint8Array;
};

export interface InvoiceIngestionService {
  ingest(documents: IncomingInvoiceDocument[]): Promise<InvoiceSubmission>;
  get(id: string): Promise<InvoiceSubmission | null>;
}
