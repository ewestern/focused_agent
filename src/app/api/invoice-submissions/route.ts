import { jsonError } from "@/lib/http";
import { getInvoiceIngestionService, InvoiceStorageError } from "@/server/invoices/ingestion";
import type { InvoiceIngestionService } from "@/server/invoices/service";
import { InvoiceDocumentValidationError } from "@/server/invoices/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function createInvoiceSubmissionPost(service: InvoiceIngestionService) {
  return async function post(request: Request): Promise<Response> {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return jsonError("invalid_multipart", "Request body must be multipart form data.", 400);
    }

    const files = form.getAll("file");
    if (files.length !== 1 || !(files[0] instanceof File)) {
      return jsonError(
        "invalid_file_count",
        "Upload exactly one invoice document in the file field.",
        400,
      );
    }

    const file = files[0];
    try {
      const submission = await service.ingest([
        {
          originalFilename: file.name || "invoice",
          bytes: new Uint8Array(await file.arrayBuffer()),
        },
      ]);
      return Response.json({ submission }, { status: 201 });
    } catch (error) {
      if (error instanceof InvoiceDocumentValidationError) {
        const status = error.code === "file_too_large" ? 413 : 415;
        return jsonError(error.code, error.message, status);
      }
      if (error instanceof InvoiceStorageError) {
        return jsonError(
          "document_storage_failed",
          error.message,
          503,
          { submissionId: error.submissionId },
        );
      }
      console.error("Invoice ingestion failed", { error });
      return jsonError("invoice_ingestion_failed", "The invoice could not be ingested.", 500);
    }
  };
}

export async function POST(request: Request): Promise<Response> {
  return createInvoiceSubmissionPost(await getInvoiceIngestionService())(request);
}
