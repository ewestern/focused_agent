import { fileTypeFromBuffer } from "file-type";

import { MAX_INVOICE_DOCUMENT_BYTES } from "@/lib/contracts";

const supportedTypes = new Set(["application/pdf", "image/png", "image/jpeg"]);

export type ValidatedInvoiceDocument = {
  contentType: "application/pdf" | "image/png" | "image/jpeg";
};

export class InvoiceDocumentValidationError extends Error {
  constructor(
    public readonly code:
      "empty_file" | "file_too_large" | "unsupported_file_type",
    message: string,
  ) {
    super(message);
    this.name = "InvoiceDocumentValidationError";
  }
}

export async function validateInvoiceDocument(
  bytes: Uint8Array,
): Promise<ValidatedInvoiceDocument> {
  if (bytes.byteLength === 0) {
    throw new InvoiceDocumentValidationError(
      "empty_file",
      "The uploaded file is empty.",
    );
  }
  if (bytes.byteLength > MAX_INVOICE_DOCUMENT_BYTES) {
    throw new InvoiceDocumentValidationError(
      "file_too_large",
      "Invoice documents must be 20 MB or smaller.",
    );
  }

  const detected = await fileTypeFromBuffer(bytes);
  if (!detected || !supportedTypes.has(detected.mime)) {
    throw new InvoiceDocumentValidationError(
      "unsupported_file_type",
      "Invoice documents must be PDF, PNG, or JPEG files.",
    );
  }
  return {
    contentType: detected.mime as ValidatedInvoiceDocument["contentType"],
  };
}
