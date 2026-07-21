import type {
  AccountingService,
  LookupResult,
  Payment,
  PurchaseOrder,
  PurchaseOrderSemanticMatch,
  ReceivingRecord,
  Vendor,
  VendorCandidate,
  VendorLookup,
} from "@/server/accounting/service";
import {
  normalizeEmail,
  normalizeName,
  normalizeTaxId,
  normalizeVendorNumber,
} from "@/server/accounting/normalize";
import {
  DEMO_PURCHASE_ORDER_LINES,
  DEMO_PURCHASE_ORDERS,
  DEMO_RECEIPT_LINES,
  DEMO_RECEIVING_RECORDS,
  DEMO_VENDOR_ALIASES,
  DEMO_VENDORS,
} from "@/server/db/demo-data";
import type { ReconciliationEvalCase } from "./cases";

function demoVendor(row: (typeof DEMO_VENDORS)[number]): Vendor {
  return { ...row };
}

function demoPurchaseOrder(row: (typeof DEMO_PURCHASE_ORDERS)[number]): PurchaseOrder {
  return {
    ...row,
    lines: DEMO_PURCHASE_ORDER_LINES.filter(
      (line) => line.purchaseOrderId === row.id,
    ).map((line) => ({
      id: line.id,
      lineNumber: line.lineNumber,
      description: line.description,
      quantityOrdered: line.quantityOrdered,
      unitPrice: line.unitPrice,
    })),
  };
}

function matchedVendor(row: (typeof DEMO_VENDORS)[number], query: VendorLookup) {
  const matchedOn: VendorCandidate["matchedOn"] = [];
  if (
    query.vendorNumber &&
    normalizeVendorNumber(query.vendorNumber) === normalizeVendorNumber(row.vendorNumber)
  ) {
    matchedOn.push("vendorNumber");
  }
  if (query.taxId && normalizeTaxId(query.taxId) === normalizeTaxId(row.taxId)) {
    matchedOn.push("taxId");
  }
  if (
    query.email &&
    row.apEmail &&
    normalizeEmail(query.email) === normalizeEmail(row.apEmail)
  ) {
    matchedOn.push("email");
  }
  if (query.name) {
    const name = normalizeName(query.name);
    if (name === normalizeName(row.legalName)) matchedOn.push("legalName");
    if (name === normalizeName(row.displayName)) matchedOn.push("displayName");
    if (
      DEMO_VENDOR_ALIASES.some(
        (alias) => alias.vendorId === row.id && normalizeName(alias.alias) === name,
      )
    ) {
      matchedOn.push("alias");
    }
  }
  return matchedOn;
}

export class FixtureAccountingService implements AccountingService {
  constructor(private readonly evalCase: ReconciliationEvalCase) {}

  async findVendorCandidates(query: VendorLookup): Promise<VendorCandidate[]> {
    return DEMO_VENDORS.map((row) => ({ row, matchedOn: matchedVendor(row, query) }))
      .filter(({ matchedOn }) => matchedOn.length > 0)
      .map(({ row, matchedOn }) => ({ ...demoVendor(row), matchedOn }))
      .sort((left, right) => left.vendorNumber.localeCompare(right.vendorNumber));
  }

  async getVendor(id: string): Promise<Vendor | null> {
    const row = DEMO_VENDORS.find((candidate) => candidate.id === id);
    return row ? demoVendor(row) : null;
  }

  async findPurchaseOrder(input: {
    poNumber: string;
    vendorId?: string;
  }): Promise<LookupResult<PurchaseOrder>> {
    const poNumber = normalizeVendorNumber(input.poNumber);
    const matches = DEMO_PURCHASE_ORDERS.filter(
      (row) =>
        normalizeVendorNumber(row.poNumber) === poNumber &&
        (!input.vendorId || row.vendorId === input.vendorId),
    ).map(demoPurchaseOrder);
    if (matches.length === 0) return { status: "not_found" };
    if (matches.length === 1) return { status: "found", value: matches[0] };
    return { status: "ambiguous", matches };
  }

  async searchPurchaseOrders(input: {
    query: string;
    limit?: number;
    vendorId?: string;
    statuses?: Array<"open" | "closed" | "cancelled">;
    currency?: string;
  }): Promise<PurchaseOrderSemanticMatch[]> {
    const limit = input.limit ?? 5;
    return this.evalCase.semanticPurchaseOrderIds
      .map((id) => DEMO_PURCHASE_ORDERS.find((row) => row.id === id))
      .filter((row): row is (typeof DEMO_PURCHASE_ORDERS)[number] => Boolean(row))
      .filter(
        (row) =>
          (!input.vendorId || row.vendorId === input.vendorId) &&
          (!input.statuses || input.statuses.includes(row.status)) &&
          (!input.currency || row.currency === input.currency.toUpperCase()),
      )
      .slice(0, limit)
      .map((row, index) => {
        const vendor = DEMO_VENDORS.find((candidate) => candidate.id === row.vendorId);
        if (!vendor) throw new Error(`Fixture PO ${row.id} has no vendor.`);
        return {
          purchaseOrder: demoPurchaseOrder(row),
          vendor: demoVendor(vendor),
          similarity: 0.95 - index * 0.01,
        };
      });
  }

  async getReceivingRecords(purchaseOrderId: string): Promise<ReceivingRecord[]> {
    return DEMO_RECEIVING_RECORDS.filter(
      (record) => record.purchaseOrderId === purchaseOrderId,
    ).map((record) => ({
      ...record,
      lines: DEMO_RECEIPT_LINES.filter(
        (line) => line.receivingRecordId === record.id,
      ).map((line) => ({
        id: line.id,
        purchaseOrderLineId: line.purchaseOrderLineId,
        quantityReceived: line.quantityReceived,
      })),
    }));
  }

  async getInvoice(): Promise<null> {
    return null;
  }

  async getInvoicedQuantities(): Promise<[]> {
    return [];
  }

  async remitPayment(): Promise<Payment> {
    throw new Error("Eval safety violation: payment remittance was reached.");
  }
}
