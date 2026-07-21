import { z } from "zod";

import { DEMO_IDS } from "@/server/db/demo-data";
import {
  EvalInputSchema,
  EvalReferenceOutputSchema,
  RECONCILIATION_EVAL_CORPUS_VERSION,
  type EvalInput,
  type EvalReferenceOutput,
} from "./schemas";

const EvalCaseSchema = z.object({
  id: EvalInputSchema.shape.caseId,
  sourcePdf: z.string().regex(/^\d{2}-[a-z0-9-]+\.pdf$/),
  scenario: z.string().min(1),
  fidelity: z.enum(["high", "medium", "low"]),
  split: z.enum(["smoke", "regression"]),
  semanticPurchaseOrderIds: z.array(z.string().uuid()).default([]),
  reference: EvalReferenceOutputSchema,
});

export type ReconciliationEvalCase = z.infer<typeof EvalCaseSchema>;

function evalCase(input: ReconciliationEvalCase): ReconciliationEvalCase {
  return EvalCaseSchema.parse(input);
}

export const RECONCILIATION_EVAL_CASES = [
  evalCase({
    id: "acme-po-1001-exact",
    sourcePdf: "01-acme-po-1001-exact.pdf",
    scenario: "exact_fully_received",
    fidelity: "high",
    split: "smoke",
    semanticPurchaseOrderIds: [],
    reference: {
      extraction: {
        invoiceNumber: "INV-ACME-1001",
        vendorNumber: "V-100",
        purchaseOrderNumber: "PO-1001",
        currency: "USD",
        lineCount: 2,
      },
      decision: {
        reviewKind: "payment",
        selectedVendorNumber: "V-100",
        selectedPurchaseOrderNumber: "PO-1001",
        discrepancyCodes: [],
        emailIntent: null,
        recipientState: null,
      },
    },
  }),
  evalCase({
    id: "acme-po-1002-partial-receipt",
    sourcePdf: "02-acme-po-1002-partial-receipt.pdf",
    scenario: "quantity_exceeds_received",
    fidelity: "high",
    split: "smoke",
    semanticPurchaseOrderIds: [],
    reference: {
      extraction: {
        invoiceNumber: "A-88421",
        vendorNumber: null,
        purchaseOrderNumber: "PO-1002",
        currency: "USD",
        lineCount: 1,
      },
      decision: {
        reviewKind: "email",
        selectedVendorNumber: "V-100",
        selectedPurchaseOrderNumber: "PO-1002",
        discrepancyCodes: ["quantity_exceeds_received_unbilled"],
        emailIntent: "discrepancy",
        recipientState: "present",
      },
    },
  }),
  evalCase({
    id: "northstar-po-1003-no-receipt",
    sourcePdf: "03-northstar-po-1003-no-receipt.pdf",
    scenario: "required_receipt_missing",
    fidelity: "medium",
    split: "smoke",
    semanticPurchaseOrderIds: [],
    reference: {
      extraction: {
        invoiceNumber: "NS-61003",
        vendorNumber: "V-200",
        purchaseOrderNumber: "PO-1003",
        currency: "USD",
        lineCount: 1,
      },
      decision: {
        reviewKind: "email",
        selectedVendorNumber: "V-200",
        selectedPurchaseOrderNumber: "PO-1003",
        discrepancyCodes: [],
        emailIntent: "receipt_proof_request",
        recipientState: "present",
      },
    },
  }),
  evalCase({
    id: "northstar-po-1004-closed",
    sourcePdf: "04-northstar-po-1004-closed.pdf",
    scenario: "closed_purchase_order",
    fidelity: "medium",
    split: "regression",
    semanticPurchaseOrderIds: [],
    reference: {
      extraction: {
        invoiceNumber: "004-7718",
        vendorNumber: null,
        purchaseOrderNumber: "PO-1004",
        currency: "USD",
        lineCount: 1,
      },
      decision: {
        reviewKind: "email",
        selectedVendorNumber: "V-200",
        selectedPurchaseOrderNumber: "PO-1004",
        discrepancyCodes: ["purchase_order_not_open"],
        emailIntent: "discrepancy",
        recipientState: "present",
      },
    },
  }),
  evalCase({
    id: "paper-trail-po-1005-no-contact",
    sourcePdf: "05-paper-trail-po-1005-no-contact.pdf",
    scenario: "missing_receipt_and_recipient",
    fidelity: "high",
    split: "smoke",
    semanticPurchaseOrderIds: [],
    reference: {
      extraction: {
        invoiceNumber: "PTS-2026-0619",
        vendorNumber: "V-300",
        purchaseOrderNumber: "PO-1005",
        currency: "USD",
        lineCount: 1,
      },
      decision: {
        reviewKind: "email",
        selectedVendorNumber: "V-300",
        selectedPurchaseOrderNumber: "PO-1005",
        discrepancyCodes: [],
        emailIntent: "receipt_proof_request",
        recipientState: "missing",
      },
    },
  }),
  evalCase({
    id: "acme-po-shared-disambiguated",
    sourcePdf: "06-acme-po-shared-disambiguated.pdf",
    scenario: "shared_po_resolved_to_acme",
    fidelity: "high",
    split: "regression",
    semanticPurchaseOrderIds: [],
    reference: {
      extraction: {
        invoiceNumber: "INV-SHARED-ACME",
        vendorNumber: "V-100",
        purchaseOrderNumber: "PO-SHARED",
        currency: "USD",
        lineCount: 1,
      },
      decision: {
        reviewKind: "email",
        selectedVendorNumber: "V-100",
        selectedPurchaseOrderNumber: "PO-SHARED",
        discrepancyCodes: [],
        emailIntent: "receipt_proof_request",
        recipientState: "present",
      },
    },
  }),
  evalCase({
    id: "northstar-po-shared-disambiguated",
    sourcePdf: "07-northstar-po-shared-disambiguated.pdf",
    scenario: "shared_po_resolved_to_northstar",
    fidelity: "high",
    split: "regression",
    semanticPurchaseOrderIds: [],
    reference: {
      extraction: {
        invoiceNumber: "NS-SHARED-220",
        vendorNumber: "V-200",
        purchaseOrderNumber: "PO-SHARED",
        currency: "USD",
        lineCount: 1,
      },
      decision: {
        reviewKind: "email",
        selectedVendorNumber: "V-200",
        selectedPurchaseOrderNumber: "PO-SHARED",
        discrepancyCodes: [],
        emailIntent: "receipt_proof_request",
        recipientState: "present",
      },
    },
  }),
  evalCase({
    id: "po-shared-ambiguous-vendor",
    sourcePdf: "07-po-shared-ambiguous-vendor.pdf",
    scenario: "ambiguous_vendor",
    fidelity: "low",
    split: "regression",
    semanticPurchaseOrderIds: [],
    reference: {
      extraction: {
        invoiceNumber: "GENERIC-7721",
        vendorNumber: null,
        purchaseOrderNumber: "PO-SHARED",
        currency: "USD",
        lineCount: 1,
      },
      decision: {
        reviewKind: "exception",
        selectedVendorNumber: null,
        selectedPurchaseOrderNumber: null,
        discrepancyCodes: [],
        emailIntent: null,
        recipientState: null,
      },
    },
  }),
  evalCase({
    id: "acme-missing-po-number",
    sourcePdf: "08-acme-missing-po-number.pdf",
    scenario: "missing_po_with_semantic_candidate",
    fidelity: "medium",
    split: "regression",
    semanticPurchaseOrderIds: [DEMO_IDS.purchaseOrders.fullyReceived],
    reference: {
      extraction: {
        invoiceNumber: "A-99008",
        vendorNumber: "V-100",
        purchaseOrderNumber: null,
        currency: "USD",
        lineCount: 1,
      },
      decision: {
        reviewKind: "exception",
        selectedVendorNumber: "V-100",
        selectedPurchaseOrderNumber: null,
        discrepancyCodes: [],
        emailIntent: null,
        recipientState: null,
      },
    },
  }),
  evalCase({
    id: "northstar-unknown-po",
    sourcePdf: "09-northstar-unknown-po.pdf",
    scenario: "unknown_po_with_semantic_candidate",
    fidelity: "high",
    split: "regression",
    semanticPurchaseOrderIds: [DEMO_IDS.purchaseOrders.noReceipts],
    reference: {
      extraction: {
        invoiceNumber: "NS-9999",
        vendorNumber: "V-200",
        purchaseOrderNumber: "PO-9999",
        currency: "USD",
        lineCount: 1,
      },
      decision: {
        reviewKind: "exception",
        selectedVendorNumber: "V-200",
        selectedPurchaseOrderNumber: null,
        discrepancyCodes: [],
        emailIntent: null,
        recipientState: null,
      },
    },
  }),
  evalCase({
    id: "unknown-vendor-and-po",
    sourcePdf: "10-unknown-vendor-and-po.pdf",
    scenario: "unknown_vendor_and_po",
    fidelity: "high",
    split: "smoke",
    semanticPurchaseOrderIds: [],
    reference: {
      extraction: {
        invoiceNumber: "FRL-20440",
        vendorNumber: "V-999",
        purchaseOrderNumber: "PO-4040",
        currency: "USD",
        lineCount: 1,
      },
      decision: {
        reviewKind: "exception",
        selectedVendorNumber: null,
        selectedPurchaseOrderNumber: null,
        discrepancyCodes: [],
        emailIntent: null,
        recipientState: null,
      },
    },
  }),
  evalCase({
    id: "vendor-po-mismatch",
    sourcePdf: "11-vendor-po-mismatch.pdf",
    scenario: "vendor_po_mismatch",
    fidelity: "high",
    split: "regression",
    semanticPurchaseOrderIds: [],
    reference: {
      extraction: {
        invoiceNumber: "NS-MISMATCH-01",
        vendorNumber: "V-200",
        purchaseOrderNumber: "PO-1001",
        currency: "USD",
        lineCount: 1,
      },
      decision: {
        reviewKind: "exception",
        selectedVendorNumber: "V-200",
        selectedPurchaseOrderNumber: "PO-1001",
        discrepancyCodes: [],
        emailIntent: null,
        recipientState: null,
      },
    },
  }),
  evalCase({
    id: "acme-po-1001-ocr-noisy",
    sourcePdf: "12-acme-po-1001-ocr-noisy.pdf",
    scenario: "ocr_identifier_normalization",
    fidelity: "low",
    split: "regression",
    semanticPurchaseOrderIds: [DEMO_IDS.purchaseOrders.fullyReceived],
    reference: {
      extraction: {
        invoiceNumber: "1NV-ACME-1001-B",
        vendorNumber: "V-100",
        purchaseOrderNumber: "P0-IOOI",
        currency: "USD",
        lineCount: 2,
      },
      decision: {
        reviewKind: "exception",
        selectedVendorNumber: "V-100",
        selectedPurchaseOrderNumber: null,
        discrepancyCodes: [],
        emailIntent: null,
        recipientState: null,
      },
    },
  }),
] as const satisfies readonly ReconciliationEvalCase[];

export function getReconciliationEvalCase(
  caseId: string,
): ReconciliationEvalCase {
  const found = RECONCILIATION_EVAL_CASES.find(
    (candidate) => candidate.id === caseId,
  );
  if (!found) throw new Error(`Unknown reconciliation eval case: ${caseId}`);
  return found;
}

export function evalInputForCase(evalCase: ReconciliationEvalCase): EvalInput {
  return EvalInputSchema.parse({
    caseId: evalCase.id,
    policyVersion: "strict-three-way-v1",
  });
}

export function referenceOutputForCase(
  evalCase: ReconciliationEvalCase,
): EvalReferenceOutput {
  return EvalReferenceOutputSchema.parse(evalCase.reference);
}

export function metadataForCase(evalCase: ReconciliationEvalCase) {
  return {
    managedBy: "focused-agent-reconciliation-evals",
    caseId: evalCase.id,
    scenario: evalCase.scenario,
    fidelity: evalCase.fidelity,
    policyVersion: "strict-three-way-v1",
    corpusVersion: RECONCILIATION_EVAL_CORPUS_VERSION,
    sourceFile: evalCase.sourcePdf,
  };
}
