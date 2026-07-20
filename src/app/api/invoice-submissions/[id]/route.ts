import type { ErrorResponse } from "@/lib/contracts";
import { getInvoiceIngestionService } from "@/server/invoices/ingestion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    const body: ErrorResponse = {
      error: { code: "invalid_submission_id", message: "Submission ID must be a UUID." },
    };
    return Response.json(body, { status: 400 });
  }
  const submission = await (await getInvoiceIngestionService()).get(id);
  if (!submission) {
    const body: ErrorResponse = {
      error: { code: "submission_not_found", message: "Invoice submission was not found." },
    };
    return Response.json(body, { status: 404 });
  }
  return Response.json({ submission });
}
