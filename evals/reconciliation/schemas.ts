import { z } from "zod";

import {
  PolicyDiscrepancySchema,
  VendorEmailFactsSchema,
} from "@/server/reconciliation/types";

export const RECONCILIATION_EVAL_DATASET =
  "focused-agent/reconciliation-first-decision";
export const RECONCILIATION_EVAL_CORPUS_VERSION = 1;
export const RECONCILIATION_EVAL_ATTACHMENT = "invoice";

export const EvalInputSchema = z.object({
  caseId: z.string().regex(/^[a-z0-9-]+$/),
  policyVersion: z.literal("strict-three-way-v1"),
});

const ExpectedExtractionSchema = z.object({
  invoiceNumber: z.string().nullable(),
  vendorNumber: z.string().nullable(),
  purchaseOrderNumber: z.string().nullable(),
  currency: z.string().length(3).nullable(),
  lineCount: z.number().int().nonnegative(),
});

const ReviewKindSchema = z.enum(["exception", "payment", "email"]);
const EmailIntentSchema = z.enum(["receipt_proof_request", "discrepancy"]);
const RecipientStateSchema = z.enum(["present", "missing"]);

const ExpectedDecisionSchema = z.object({
  reviewKind: ReviewKindSchema,
  selectedVendorNumber: z.string().nullable(),
  selectedPurchaseOrderNumber: z.string().nullable(),
  discrepancyCodes: z.array(PolicyDiscrepancySchema.shape.code),
  emailIntent: EmailIntentSchema.nullable(),
  recipientState: RecipientStateSchema.nullable(),
});

export const EvalReferenceOutputSchema = z.object({
  extraction: ExpectedExtractionSchema,
  decision: ExpectedDecisionSchema,
});

const ActualEmailSchema = z.object({
  intent: EmailIntentSchema,
  to: z.array(z.string().email()),
  cc: z.array(z.string().email()),
  subject: z.string(),
  text: z.string(),
  facts: VendorEmailFactsSchema,
});

export const EvalActualOutputSchema = EvalReferenceOutputSchema.extend({
  email: ActualEmailSchema.nullable(),
});

export type EvalInput = z.infer<typeof EvalInputSchema>;
export type EvalReferenceOutput = z.infer<typeof EvalReferenceOutputSchema>;
export type EvalActualOutput = z.infer<typeof EvalActualOutputSchema>;

