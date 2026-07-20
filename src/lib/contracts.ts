export const MAX_INVOICE_DOCUMENT_BYTES = 20 * 1024 * 1024;

export type HealthResponse = {
  status: "ok" | "degraded";
  checks: {
    database: boolean;
    pgvector: boolean;
    objectStorage: boolean;
    email: boolean;
    agentConfigured: boolean;
  };
};

export type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

export type InvoiceDocument = {
  id: string;
  originalFilename: string;
  contentType: "application/pdf" | "image/png" | "image/jpeg";
  byteSize: number;
  sha256: string;
};

export type InvoiceSubmission = {
  id: string;
  status: "receiving" | "received" | "failed";
  failureCode: string | null;
  failureMessage: string | null;
  receivedAt: string | null;
  createdAt: string;
  documents: InvoiceDocument[];
  reconciliationId: string | null;
};

export type InvoiceSubmissionResponse = {
  submission: InvoiceSubmission;
};
