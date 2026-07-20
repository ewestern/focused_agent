import { jsonError } from "@/lib/http";
import { ResourceIdSchema } from "@/lib/reconciliation-contracts";
import { getInvoiceIngestionService } from "@/server/invoices/ingestion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!ResourceIdSchema.safeParse(id).success) {
    return jsonError("invalid_submission_id", "Submission ID must be a UUID.", 400);
  }
  const submission = await (await getInvoiceIngestionService()).get(id);
  if (!submission) {
    return jsonError("submission_not_found", "Invoice submission was not found.", 404);
  }
  return Response.json({ submission });
}
