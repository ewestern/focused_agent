import { describe, expect, it } from "vitest";

import { renderVendorEmailFactBlock } from "@/server/reconciliation/model-services";
import { getReconciliationEvalCase } from "../../evals/reconciliation/cases";
import { scoreReconciliationOutput } from "../../evals/reconciliation/evaluators";

describe("reconciliation evaluators", () => {
  const reference = getReconciliationEvalCase("acme-po-1001-exact").reference;

  it("scores a matching normalized outcome", () => {
    const scores = scoreReconciliationOutput(
      { ...reference, email: null },
      reference,
    );
    expect(scores).toHaveLength(7);
    expect(scores.every((score) => score.score === 1)).toBe(true);
  });

  it("reports route and discrepancy regressions independently", () => {
    const scores = scoreReconciliationOutput(
      {
        ...reference,
        decision: {
          ...reference.decision,
          reviewKind: "email",
          discrepancyCodes: ["duplicate_invoice"],
        },
        email: null,
      },
      reference,
    );
    expect(scores.find((score) => score.key === "review_route")?.score).toBe(0);
    expect(
      scores.find((score) => score.key === "discrepancy_codes")?.score,
    ).toBe(0);
    expect(scores.find((score) => score.key === "overall")?.score).toBe(0);
  });

  it("treats discrepancy codes as an unordered set", () => {
    const multiReference = {
      ...reference,
      decision: {
        ...reference.decision,
        discrepancyCodes: ["vendor_mismatch", "unit_price_mismatch"],
      },
    };
    const scores = scoreReconciliationOutput(
      {
        ...multiReference,
        decision: {
          ...multiReference.decision,
          discrepancyCodes: ["unit_price_mismatch", "vendor_mismatch"],
        },
        email: null,
      },
      multiReference,
    );
    expect(
      scores.find((score) => score.key === "discrepancy_codes")?.score,
    ).toBe(1);
  });

  it("requires the exact structured fact block in vendor email text", () => {
    const emailReference = getReconciliationEvalCase(
      "northstar-po-1003-no-receipt",
    ).reference;
    const facts = {
      invoiceNumber: "NS-61003",
      purchaseOrderNumber: "PO-1003",
      invoiceTotal: "187.5000",
      currency: "USD",
      receivingEvidence: "missing" as const,
      lines: [
        {
          description: "Copy paper",
          invoicedQuantity: "25.0000",
          invoiceUnitPrice: "7.5000",
          invoiceAmount: "187.5000",
          orderedQuantity: "25.0000",
          purchaseOrderUnitPrice: "7.5000",
          receivedUnbilledQuantity: null,
          quantityDifference: null,
        },
      ],
      discrepancies: [],
      additionalReasons: [],
    };
    const actual = {
      ...emailReference,
      email: {
        intent: "receipt_proof_request" as const,
        to: ["billing@northstar.example"],
        cc: [],
        subject: "Receipt evidence requested",
        text: `Hello.\n\n${renderVendorEmailFactBlock(facts)}\n\nPlease send receipt evidence.`,
        facts,
      },
    };
    expect(
      scoreReconciliationOutput(actual, emailReference).find(
        (score) => score.key === "email_structure",
      )?.score,
    ).toBe(1);
    expect(
      scoreReconciliationOutput(
        {
          ...actual,
          email: { ...actual.email, text: "Please send receipt evidence." },
        },
        emailReference,
      ).find((score) => score.key === "email_structure")?.score,
    ).toBe(0);
  });
});
