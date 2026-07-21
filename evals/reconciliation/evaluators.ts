import type { EvaluationResult } from "langsmith/evaluation";

import { renderVendorEmailFactBlock } from "@/server/reconciliation/model-services";
import { EmailDraftSchema } from "@/server/reconciliation/types";
import {
  EvalActualOutputSchema,
  EvalReferenceOutputSchema,
  type EvalActualOutput,
  type EvalReferenceOutput,
} from "./schemas";

function equalStringSets(left: string[], right: string[]): boolean {
  const sortedLeft = [...new Set(left)].sort();
  const sortedRight = [...new Set(right)].sort();
  return JSON.stringify(sortedLeft) === JSON.stringify(sortedRight);
}

function result(
  key: string,
  passed: boolean,
  comment?: string,
): EvaluationResult {
  return { key, score: passed ? 1 : 0, comment };
}

function emailIsStructured(
  actual: EvalActualOutput,
  reference: EvalReferenceOutput,
): boolean {
  if (reference.decision.emailIntent === null) return actual.email === null;
  if (!actual.email) return false;
  const draftValid = EmailDraftSchema.safeParse({
    to: actual.email.to,
    cc: actual.email.cc,
    subject: actual.email.subject,
    text: actual.email.text,
  }).success;
  const factBlock = renderVendorEmailFactBlock(actual.email.facts);
  const factCodes = actual.email.facts.discrepancies.map((item) => item.code);
  return (
    draftValid &&
    actual.email.intent === reference.decision.emailIntent &&
    actual.email.text.includes(factBlock) &&
    equalStringSets(factCodes, actual.decision.discrepancyCodes) &&
    (actual.email.intent !== "receipt_proof_request" || factCodes.length === 0)
  );
}

export function scoreReconciliationOutput(
  rawActual: unknown,
  rawReference: unknown,
): EvaluationResult[] {
  const actual = EvalActualOutputSchema.parse(rawActual);
  const reference = EvalReferenceOutputSchema.parse(rawReference);
  const extractionFields = [
    "invoiceNumber",
    "vendorNumber",
    "purchaseOrderNumber",
    "currency",
    "lineCount",
  ] as const;
  const extractionPassed = extractionFields.every(
    (field) => actual.extraction[field] === reference.extraction[field],
  );
  const routePassed =
    actual.decision.reviewKind === reference.decision.reviewKind;
  const resolutionPassed =
    actual.decision.selectedVendorNumber ===
      reference.decision.selectedVendorNumber &&
    actual.decision.selectedPurchaseOrderNumber ===
      reference.decision.selectedPurchaseOrderNumber;
  const discrepanciesPassed = equalStringSets(
    actual.decision.discrepancyCodes,
    reference.decision.discrepancyCodes,
  );
  const emailOutcomePassed =
    actual.decision.emailIntent === reference.decision.emailIntent &&
    actual.decision.recipientState === reference.decision.recipientState;
  const emailStructurePassed = emailIsStructured(actual, reference);
  const checks = [
    result("extraction_identifiers", extractionPassed),
    result("review_route", routePassed),
    result("entity_resolution", resolutionPassed),
    result("discrepancy_codes", discrepanciesPassed),
    result("email_outcome", emailOutcomePassed),
    result("email_structure", emailStructurePassed),
  ];
  return [
    ...checks,
    result(
      "overall",
      checks.every((check) => check.score === 1),
    ),
  ];
}

export function reconciliationEvaluator({
  outputs,
  referenceOutputs,
}: {
  outputs: Record<string, unknown>;
  referenceOutputs?: Record<string, unknown>;
}): EvaluationResult[] {
  if (!referenceOutputs)
    throw new Error("Reconciliation eval reference output is missing.");
  return scoreReconciliationOutput(outputs, referenceOutputs);
}
