import type { ErrorResponse } from "@/lib/contracts";
import { getInvoiceIngestionService, InvoiceStorageError } from "@/server/invoices/ingestion";
import type { InvoiceIngestionService } from "@/server/invoices/service";
import { InvoiceDocumentValidationError } from "@/server/invoices/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(
  code: string,
  message: string,
  status: number,
  submissionId?: string,
): Response {
  const body: ErrorResponse & { submissionId?: string } = {
    error: { code, message },
    ...(submissionId ? { submissionId } : {}),
  };
  return Response.json(body, { status });
}

export function createInvoiceSubmissionPost(service: InvoiceIngestionService) {
  return async function post(request: Request): Promise<Response> {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return errorResponse("invalid_multipart", "Request body must be multipart form data.", 400);
    }

    const files = form.getAll("file");
    if (files.length !== 1 || !(files[0] instanceof File)) {
      return errorResponse(
        "invalid_file_count",
        "Upload exactly one invoice document in the file field.",
        400,
      );
    }

    const file = files[0];
    try {
      const submission = await service.ingest(
        { kind: "manual" },
        [
          {
            originalFilename: file.name || "invoice",
            bytes: new Uint8Array(await file.arrayBuffer()),
          },
        ],
      );
      return Response.json({ submission }, { status: 201 });
    } catch (error) {
      if (error instanceof InvoiceDocumentValidationError) {
        const status = error.code === "file_too_large" ? 413 : 415;
        return errorResponse(error.code, error.message, status);
      }
      if (error instanceof InvoiceStorageError) {
        return errorResponse(
          "document_storage_failed",
          error.message,
          503,
          error.submissionId,
        );
      }
      console.error("Invoice ingestion failed", { error });
      return errorResponse("invoice_ingestion_failed", "The invoice could not be ingested.", 500);
    }
  };
}

export async function POST(request: Request): Promise<Response> {
  return createInvoiceSubmissionPost(await getInvoiceIngestionService())(request);
}
