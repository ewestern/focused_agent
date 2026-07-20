import type { ErrorResponse } from "@/lib/contracts";

export function jsonError(
  code: string,
  message: string,
  status: number,
  details: Record<string, unknown> = {},
): Response {
  const body: ErrorResponse & Record<string, unknown> = {
    error: { code, message },
    ...details,
  };
  return Response.json(body, { status });
}
