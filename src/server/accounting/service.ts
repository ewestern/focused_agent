export type Vendor = {
  id: string;
  vendorNumber: string;
  legalName: string;
  displayName: string;
  taxId: string | null;
  apEmail: string | null;
};

export type VendorLookup = {
  vendorNumber?: string;
  taxId?: string;
  email?: string;
  name?: string;
};

export type VendorMatchField =
  | "vendorNumber"
  | "taxId"
  | "email"
  | "legalName"
  | "displayName"
  | "alias";

export type VendorCandidate = Vendor & {
  matchedOn: VendorMatchField[];
};

export type PurchaseOrderLine = {
  id: string;
  lineNumber: number;
  description: string;
  quantityOrdered: string;
  unitPrice: string;
};

export type PurchaseOrder = {
  id: string;
  poNumber: string;
  vendorId: string;
  status: "open" | "closed" | "cancelled";
  currency: string;
  orderedAt: string;
  closedAt: string | null;
  lines: PurchaseOrderLine[];
};

export type PurchaseOrderStatus = PurchaseOrder["status"];

export type PurchaseOrderLookup = {
  poNumber: string;
  vendorId?: string;
};

export type PurchaseOrderSemanticQuery = {
  query: string;
  limit?: number;
  vendorId?: string;
  statuses?: PurchaseOrderStatus[];
  currency?: string;
  orderedFrom?: string;
  orderedTo?: string;
};

export type PurchaseOrderSemanticMatch = {
  purchaseOrder: PurchaseOrder;
  vendor: Vendor;
  similarity: number;
};

export type LookupResult<T> =
  | { status: "found"; value: T }
  | { status: "not_found" }
  | { status: "ambiguous"; matches: T[] };

export type ReceiptLine = {
  id: string;
  purchaseOrderLineId: string;
  quantityReceived: string;
};

export type ReceivingRecord = {
  id: string;
  purchaseOrderId: string;
  receiptNumber: string;
  receivedAt: string;
  lines: ReceiptLine[];
};

export type AccountingInvoice = {
  id: string;
  reconciliationId: string;
  vendorId: string;
  purchaseOrderId: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string;
  amount: string;
  status: "remitted";
};

export type InvoicedQuantity = {
  purchaseOrderLineId: string;
  quantityInvoiced: string;
};

export type RemittanceLine = {
  sourceLineNumber: number | null;
  purchaseOrderLineId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
};

export type RemitPaymentInput = {
  reconciliationId: string;
  idempotencyKey: string;
  vendorId: string;
  purchaseOrderId: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string;
  amount: string;
  lines: RemittanceLine[];
};

export type Payment = {
  id: string;
  accountingInvoiceId: string;
  reconciliationId: string;
  idempotencyKey: string;
  status: "submitted";
  amount: string;
  currency: string;
  dueDate: string | null;
  submittedAt: string;
};

export class RemittanceConflictError extends Error {
  constructor(
    public readonly code:
      | "duplicate_invoice"
      | "insufficient_received_quantity"
      | "purchase_order_changed",
    message: string,
  ) {
    super(message);
    this.name = "RemittanceConflictError";
  }
}

export interface AccountingService {
  findVendorCandidates(query: VendorLookup): Promise<VendorCandidate[]>;
  getVendor(id: string): Promise<Vendor | null>;
  findPurchaseOrder(
    query: PurchaseOrderLookup,
  ): Promise<LookupResult<PurchaseOrder>>;
  searchPurchaseOrders(
    query: PurchaseOrderSemanticQuery,
  ): Promise<PurchaseOrderSemanticMatch[]>;
  getReceivingRecords(purchaseOrderId: string): Promise<ReceivingRecord[]>;
  getInvoice(query: {
    vendorId: string;
    invoiceNumber: string;
  }): Promise<AccountingInvoice | null>;
  getInvoicedQuantities(purchaseOrderId: string): Promise<InvoicedQuantity[]>;
  remitPayment(input: RemitPaymentInput): Promise<Payment>;
}
