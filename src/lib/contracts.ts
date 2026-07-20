import { z } from "zod";

export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  checks: z.object({
    database: z.boolean(),
    pgvector: z.boolean(),
    objectStorage: z.boolean(),
    email: z.boolean(),
    agentConfigured: z.boolean(),
  }),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

export const InvoiceDocumentSchema = z.object({
  id: z.string().uuid(),
  originalFilename: z.string(),
  contentType: z.enum(["application/pdf", "image/png", "image/jpeg"]),
  byteSize: z.number().int().nonnegative(),
  sha256: z.string().length(64),
});

export const InvoiceSubmissionSchema = z.object({
  id: z.string().uuid(),
  sourceKind: z.literal("manual"),
  sourceExternalId: z.string().nullable(),
  status: z.enum(["receiving", "received", "failed"]),
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
  receivedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  documents: z.array(InvoiceDocumentSchema),
  reconciliationId: z.string().uuid().nullable(),
});

export type InvoiceSubmissionResponse = {
  submission: z.infer<typeof InvoiceSubmissionSchema>;
};
