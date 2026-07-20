import type { ErrorResponse } from "@/lib/contracts";
import { ReconciliationIdSchema } from "@/lib/reconciliation-contracts";
import { getDatabase } from "@/server/db/client";
import { getDocumentStore } from "@/server/documents/s3";
import { InvoiceSubmissionRepository } from "@/server/invoices/postgres-repository";
import { ReconciliationRepository } from "@/server/reconciliation/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const parsed = ReconciliationIdSchema.safeParse((await context.params).id);
  if (!parsed.success) {
    const body: ErrorResponse = {
      error: { code: "invalid_reconciliation_id", message: "Reconciliation ID must be a UUID." },
    };
    return Response.json(body, { status: 400 });
  }
  const detail = await new ReconciliationRepository(getDatabase()).getDetail(parsed.data);
  if (!detail) {
    const body: ErrorResponse = {
      error: { code: "reconciliation_not_found", message: "Reconciliation was not found." },
    };
    return Response.json(body, { status: 404 });
  }
  const source = await new InvoiceSubmissionRepository(getDatabase()).getForProcessing(
    detail.submissionId,
  );
  const document = source?.documents[0];
  if (!document) {
    const body: ErrorResponse = {
      error: { code: "document_not_found", message: "Invoice document was not found." },
    };
    return Response.json(body, { status: 404 });
  }
  const bytes = await getDocumentStore().get(document.objectKey);
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": document.contentType,
      "Content-Disposition": `inline; filename="${document.originalFilename.replaceAll('"', "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
