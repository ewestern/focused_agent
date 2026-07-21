import { describe, expect, it } from "vitest";

import { MAX_INVOICE_DOCUMENT_BYTES } from "@/lib/contracts";
import {
  InvoiceDocumentValidationError,
  validateInvoiceDocument,
} from "@/server/invoices/validation";

describe("invoice document validation", () => {
  it("detects supported content from bytes", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n");
    await expect(validateInvoiceDocument(pdf)).resolves.toEqual({
      contentType: "application/pdf",
    });
  });

  it("rejects empty, oversized, and unsupported files with stable codes", async () => {
    await expect(
      validateInvoiceDocument(new Uint8Array()),
    ).rejects.toMatchObject({
      code: "empty_file",
    } satisfies Partial<InvoiceDocumentValidationError>);
    await expect(
      validateInvoiceDocument(new Uint8Array(MAX_INVOICE_DOCUMENT_BYTES + 1)),
    ).rejects.toMatchObject({ code: "file_too_large" });
    await expect(
      validateInvoiceDocument(new TextEncoder().encode("not an invoice")),
    ).rejects.toMatchObject({ code: "unsupported_file_type" });
  });
});
