import { jsonError } from "@/lib/http";
import { ResourceIdSchema } from "@/lib/reconciliation-contracts";
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
  const parsed = ResourceIdSchema.safeParse((await context.params).id);
  if (!parsed.success) {
    return jsonError(
      "invalid_reconciliation_id",
      "Reconciliation ID must be a UUID.",
      400,
    );
  }
  const reconciliation = await new ReconciliationRepository(
    getDatabase(),
  ).getCore(parsed.data);
  if (!reconciliation) {
    return jsonError(
      "reconciliation_not_found",
      "Reconciliation was not found.",
      404,
    );
  }
  const source = await new InvoiceSubmissionRepository(
    getDatabase(),
  ).getForProcessing(reconciliation.submissionId);
  const document = source?.documents[0];
  if (!document) {
    return jsonError(
      "document_not_found",
      "Invoice document was not found.",
      404,
    );
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
