import { z } from "zod";

const NullableText = z.string().trim().min(1).nullable();
const DecimalString = z
  .string()
  .trim()
  .regex(/^-?\d+(?:\.\d{1,4})?$/, "Expected a decimal with at most four places.");
const NullableDecimalString = DecimalString.nullable();
const IsoDate = z.string().date().nullable();

export const InvoiceEvidenceSchema = z.object({
  page: z.number().int().positive(),
  text: z.string().trim().min(1).max(500),
});

export const ExtractedInvoiceLineSchema = z.object({
  sourceLineNumber: z.number().int().positive().nullable(),
  purchaseOrderLineNumber: z.number().int().positive().nullable(),
  description: z.string().trim().min(1),
  quantity: DecimalString,
  unitPrice: DecimalString,
  amount: DecimalString,
  evidence: z.array(InvoiceEvidenceSchema).max(5).default([]),
  confidence: z.number().min(0).max(1),
});

export const ExtractedInvoiceSchema = z.object({
  invoiceNumber: NullableText,
  invoiceDate: IsoDate,
  dueDate: IsoDate,
  purchaseOrderNumber: NullableText,
  vendor: z.object({
    name: NullableText,
    vendorNumber: NullableText,
    taxId: NullableText,
    email: z.string().email().nullable(),
  }),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).nullable(),
  lines: z.array(ExtractedInvoiceLineSchema).min(1),
  subtotal: NullableDecimalString,
  tax: NullableDecimalString,
  freight: NullableDecimalString,
  total: DecimalString,
  evidence: z.array(InvoiceEvidenceSchema).max(20).default([]),
  warnings: z.array(z.string().trim().min(1)).default([]),
  confidence: z.number().min(0).max(1),
});

export type ExtractedInvoice = z.infer<typeof ExtractedInvoiceSchema>;
export type ExtractedInvoiceLine = z.infer<typeof ExtractedInvoiceLineSchema>;

export const InvoiceLineMatchSchema = z.object({
  invoiceLineIndex: z.number().int().nonnegative(),
  purchaseOrderLineId: z.string().uuid(),
  method: z.enum(["line_number", "description", "model", "human"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().trim().min(1),
});

export type InvoiceLineMatch = z.infer<typeof InvoiceLineMatchSchema>;

export const PolicyDiscrepancySchema = z.object({
  code: z.enum([
    "duplicate_invoice",
    "purchase_order_not_open",
    "vendor_mismatch",
    "currency_mismatch",
    "unmatched_line",
    "ambiguous_line",
    "unit_price_mismatch",
    "quantity_exceeds_ordered",
    "quantity_exceeds_received_unbilled",
    "invoice_math_mismatch",
    "unsupported_charge",
  ]),
  message: z.string(),
  invoiceLineIndex: z.number().int().nonnegative().optional(),
  purchaseOrderLineId: z.string().uuid().optional(),
  expected: z.string().optional(),
  actual: z.string().optional(),
});

export type PolicyDiscrepancy = z.infer<typeof PolicyDiscrepancySchema>;

export const EmailDraftSchema = z.object({
  to: z.array(z.string().email()).max(10),
  cc: z.array(z.string().email()).max(10).default([]),
  subject: z.string().trim().min(1).max(300),
  text: z.string().trim().min(1).max(20_000),
});

export type EmailDraft = z.infer<typeof EmailDraftSchema>;

export const ExceptionReviewDecisionSchema = z.object({
  reviewId: z.string().uuid(),
  kind: z.literal("exception"),
  action: z.enum(["continue", "cancel"]),
  extraction: ExtractedInvoiceSchema.optional(),
  vendorId: z.string().uuid().optional(),
  purchaseOrderId: z.string().uuid().optional(),
  lineMatches: z.array(InvoiceLineMatchSchema).optional(),
  comment: z.string().trim().max(2_000).optional(),
});

export const PaymentReviewDecisionSchema = z.object({
  reviewId: z.string().uuid(),
  kind: z.literal("payment"),
  action: z.enum(["approve_payment", "route_to_dispute", "cancel"]),
  comment: z.string().trim().max(2_000).optional(),
  reason: z.string().trim().min(1).max(2_000).optional(),
});

export const EmailReviewDecisionSchema = z.object({
  reviewId: z.string().uuid(),
  kind: z.literal("email"),
  action: z.enum(["send_email", "cancel"]),
  draft: EmailDraftSchema.optional(),
  comment: z.string().trim().max(2_000).optional(),
});

export const ReviewDecisionSchema = z.discriminatedUnion("kind", [
  ExceptionReviewDecisionSchema,
  PaymentReviewDecisionSchema,
  EmailReviewDecisionSchema,
]);

export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

export const ReviewRequestSchema = z.object({
  reviewId: z.string().uuid(),
  reconciliationId: z.string().uuid(),
  kind: z.enum(["exception", "payment", "email"]),
  title: z.string(),
  summary: z.string(),
  payload: z.record(z.string(), z.unknown()),
  requestedVersion: z.number().int().positive(),
});

export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;

export type ReconciliationStatus =
  | "queued"
  | "processing"
  | "awaiting_exception_review"
  | "awaiting_payment_approval"
  | "awaiting_email_approval"
  | "payment_submitted"
  | "dispute_sent"
  | "cancelled"
  | "failed";

