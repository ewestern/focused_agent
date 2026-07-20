import { describe, expect, it, vi } from "vitest";

import {
  composeReconciliationFailureEmail,
  ReconciliationFailureEmailService,
} from "@/server/email/reconciliation-failure";
import type { EmailService } from "@/server/email/service";

const invoice = {
  invoiceNumber: "INV-42",
  vendorName: "Acme",
  invoiceContactEmail: "sender@acme.example",
  purchaseOrderNumber: "PO-42",
};

describe("reconciliation failure email", () => {
  it("sends to the invoice contact and copies a distinct vendor AP contact", () => {
    const message = composeReconciliationFailureEmail({
      from: "agent@example.test",
      invoice,
      vendor: { displayName: "Acme", apEmail: "ap@acme.example" },
      reason: "No matching purchase order was found.",
    });
    expect(message).toMatchObject({
      to: ["sender@acme.example"],
      cc: ["ap@acme.example"],
      subject: "Unable to reconcile invoice INV-42",
    });
    expect(message?.text).toContain("PO-42");
  });

  it("falls back to vendor AP and does not duplicate recipients", () => {
    expect(
      composeReconciliationFailureEmail({
        from: "agent@example.test",
        invoice: { ...invoice, invoiceContactEmail: null },
        vendor: { displayName: "Acme", apEmail: "ap@acme.example" },
        reason: "Missing PO.",
      }),
    ).toMatchObject({ to: ["ap@acme.example"], cc: undefined });

    expect(
      composeReconciliationFailureEmail({
        from: "agent@example.test",
        invoice: { ...invoice, invoiceContactEmail: "AP@acme.example" },
        vendor: { displayName: "Acme", apEmail: "ap@acme.example" },
        reason: "Missing PO.",
      }),
    ).toMatchObject({ to: ["AP@acme.example"], cc: undefined });
  });

  it("does not send when neither contact is available", async () => {
    const send = vi.fn();
    const email = { send, isHealthy: vi.fn() } as unknown as EmailService;
    const service = new ReconciliationFailureEmailService(email, "agent@example.test");
    await expect(
      service.send({
        invoice: { ...invoice, invoiceContactEmail: null },
        vendor: { displayName: "Acme", apEmail: null },
        reason: "Missing PO.",
      }),
    ).resolves.toEqual({ status: "recipient_unavailable" });
    expect(send).not.toHaveBeenCalled();
  });
});
