import { z } from "zod";

import type {
  PurchaseOrder,
  PurchaseOrderSemanticMatch,
  ReceivingRecord,
  Vendor,
  VendorCandidate,
} from "@/server/accounting/service";

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

const ReviewId = z.string().uuid();
const ReviewComment = z.string().trim().max(2_000).optional();

export const PaymentReviewDecisionSchema = z.discriminatedUnion("action", [
  z.object({
    reviewId: ReviewId,
    kind: z.literal("payment"),
    action: z.literal("approve_payment"),
    comment: ReviewComment,
  }),
  z.object({
    reviewId: ReviewId,
    kind: z.literal("payment"),
    action: z.literal("route_to_dispute"),
    reason: z.string().trim().min(1).max(2_000),
    comment: ReviewComment,
  }),
  z.object({
    reviewId: ReviewId,
    kind: z.literal("payment"),
    action: z.literal("cancel"),
    comment: ReviewComment,
  }),
]);

export const EmailReviewDecisionSchema = z.discriminatedUnion("action", [
  z.object({
    reviewId: ReviewId,
    kind: z.literal("email"),
    action: z.literal("send_email"),
    draft: EmailDraftSchema,
    comment: ReviewComment,
  }),
  z.object({
    reviewId: ReviewId,
    kind: z.literal("email"),
    action: z.literal("cancel"),
    comment: ReviewComment,
  }),
]);

export const ReviewDecisionSchema = z.union([
  ExceptionReviewDecisionSchema,
  PaymentReviewDecisionSchema,
  EmailReviewDecisionSchema,
]);

export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

type ReviewRequestBase<Kind extends string, Payload> = {
  reviewId: string;
  reconciliationId: string;
  kind: Kind;
  title: string;
  summary: string;
  payload: Payload;
  requestedVersion: number;
};

export type ExceptionReviewPayload = {
  issues: string[];
  extraction: ExtractedInvoice | null;
  vendorCandidates: VendorCandidate[];
  purchaseOrderCandidates: PurchaseOrderSemanticMatch[];
  exactPurchaseOrderCandidates: PurchaseOrder[];
  lineMatches: InvoiceLineMatch[];
};

export type PaymentReviewPayload = {
  extraction: ExtractedInvoice | null;
  vendor: Vendor | null;
  purchaseOrder: PurchaseOrder | null;
  receivingRecords: ReceivingRecord[];
  lineMatches: InvoiceLineMatch[];
  discrepancies: PolicyDiscrepancy[];
};

export type EmailReviewPayload = {
  draft: EmailDraft;
  discrepancies: PolicyDiscrepancy[];
};

type ExceptionReviewRequest = ReviewRequestBase<
  "exception",
  ExceptionReviewPayload
>;
type PaymentReviewRequest = ReviewRequestBase<"payment", PaymentReviewPayload>;
type EmailReviewRequest = ReviewRequestBase<"email", EmailReviewPayload>;

export type ReviewRequest =
  | ExceptionReviewRequest
  | PaymentReviewRequest
  | EmailReviewRequest;

export type CreateReviewInput =
  | Omit<ExceptionReviewRequest, "reviewId" | "requestedVersion">
  | Omit<PaymentReviewRequest, "reviewId" | "requestedVersion">
  | Omit<EmailReviewRequest, "reviewId" | "requestedVersion">;

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
