import type { EmailMessage, EmailSendResult, EmailService } from "@/server/email/service";

export type InvoiceEmailContext = {
  invoiceNumber: string;
  vendorName: string;
  invoiceContactEmail?: string | null;
  purchaseOrderNumber?: string | null;
};

export type VendorEmailContext = {
  displayName: string;
  apEmail: string | null;
};

export type ReconciliationFailureEmailResult =
  | { status: "sent"; delivery: EmailSendResult }
  | { status: "recipient_unavailable" };

export function composeReconciliationFailureEmail(input: {
  from: string;
  invoice: InvoiceEmailContext;
  vendor?: VendorEmailContext | null;
  reason: string;
}): EmailMessage | null {
  const invoiceContact = input.invoice.invoiceContactEmail?.trim();
  const vendorContact = input.vendor?.apEmail?.trim();
  const to = invoiceContact || vendorContact;
  if (!to) return null;

  const cc =
    invoiceContact &&
    vendorContact &&
    invoiceContact.toLocaleLowerCase("en-US") !==
      vendorContact.toLocaleLowerCase("en-US")
      ? [vendorContact]
      : undefined;
  const poLine = input.invoice.purchaseOrderNumber
    ? `Purchase order: ${input.invoice.purchaseOrderNumber}\n`
    : "";

  return {
    from: input.from,
    to: [to],
    cc,
    subject: `Unable to reconcile invoice ${input.invoice.invoiceNumber}`,
    text: [
      `Hello ${input.invoice.vendorName},`,
      "",
      `We could not reconcile invoice ${input.invoice.invoiceNumber} with our purchase order and receiving records.`,
      poLine.trimEnd(),
      `Reason: ${input.reason}`,
      "",
      "Please reply with the correct purchase order or supporting information.",
    ]
      .filter((line) => line !== "")
      .join("\n"),
  };
}

export class ReconciliationFailureEmailService {
  constructor(
    private readonly email: EmailService,
    private readonly from: string,
  ) {}

  async send(input: {
    invoice: InvoiceEmailContext;
    vendor?: VendorEmailContext | null;
    reason: string;
  }): Promise<ReconciliationFailureEmailResult> {
    const message = composeReconciliationFailureEmail({
      ...input,
      from: this.from,
    });
    if (!message) return { status: "recipient_unavailable" };
    return { status: "sent", delivery: await this.email.send(message) };
  }
}
