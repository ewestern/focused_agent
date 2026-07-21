import type { PurchaseOrderSearchSource } from "@/server/accounting/purchase-order-search";

export const DEMO_IDS = {
  vendors: {
    acme: "00000000-0000-4000-8000-000000000001",
    northstar: "00000000-0000-4000-8000-000000000002",
    noContact: "00000000-0000-4000-8000-000000000003",
  },
  purchaseOrders: {
    fullyReceived: "00000000-0000-4000-8000-000000000101",
    partiallyReceived: "00000000-0000-4000-8000-000000000102",
    noReceipts: "00000000-0000-4000-8000-000000000103",
    closed: "00000000-0000-4000-8000-000000000104",
    missingContact: "00000000-0000-4000-8000-000000000105",
    sharedAcme: "00000000-0000-4000-8000-000000000106",
    sharedNorthstar: "00000000-0000-4000-8000-000000000107",
  },
  lines: {
    fullOne: "00000000-0000-4000-8000-000000001101",
    fullTwo: "00000000-0000-4000-8000-000000001102",
    partial: "00000000-0000-4000-8000-000000001103",
    noReceipt: "00000000-0000-4000-8000-000000001104",
    closed: "00000000-0000-4000-8000-000000001105",
    missingContact: "00000000-0000-4000-8000-000000001106",
    sharedAcme: "00000000-0000-4000-8000-000000001107",
    sharedNorthstar: "00000000-0000-4000-8000-000000001108",
  },
  receipts: {
    full: "00000000-0000-4000-8000-000000002101",
    partial: "00000000-0000-4000-8000-000000002102",
  },
} as const;

export const UNKNOWN_VENDOR_LOOKUP = {
  vendorNumber: "V-DOES-NOT-EXIST",
} as const;

export const DEMO_VENDORS = [
  {
    id: DEMO_IDS.vendors.acme,
    vendorNumber: "V-100",
    legalName: "Acme Industrial Supply, Inc.",
    displayName: "Acme Industrial",
    taxId: "12-3456789",
    apEmail: "ap@acme.example",
  },
  {
    id: DEMO_IDS.vendors.northstar,
    vendorNumber: "V-200",
    legalName: "Northstar Office Products LLC",
    displayName: "Northstar Office",
    taxId: "98-7654321",
    apEmail: "billing@northstar.example",
  },
  {
    id: DEMO_IDS.vendors.noContact,
    vendorNumber: "V-300",
    legalName: "Paper Trail Services LLC",
    displayName: "Paper Trail",
    taxId: "11-2223333",
    apEmail: null,
  },
] as const;

export const DEMO_VENDOR_ALIASES = [
  {
    id: "00000000-0000-4000-8000-000000000011",
    vendorId: DEMO_IDS.vendors.acme,
    alias: "Acme Supply",
  },
  {
    id: "00000000-0000-4000-8000-000000000012",
    vendorId: DEMO_IDS.vendors.northstar,
    alias: "Northstar",
  },
] as const;

export const DEMO_PURCHASE_ORDERS = [
  {
    id: DEMO_IDS.purchaseOrders.fullyReceived,
    poNumber: "PO-1001",
    vendorId: DEMO_IDS.vendors.acme,
    status: "open",
    currency: "USD",
    orderedAt: "2026-06-01",
    closedAt: null,
  },
  {
    id: DEMO_IDS.purchaseOrders.partiallyReceived,
    poNumber: "PO-1002",
    vendorId: DEMO_IDS.vendors.acme,
    status: "open",
    currency: "USD",
    orderedAt: "2026-06-05",
    closedAt: null,
  },
  {
    id: DEMO_IDS.purchaseOrders.noReceipts,
    poNumber: "PO-1003",
    vendorId: DEMO_IDS.vendors.northstar,
    status: "open",
    currency: "USD",
    orderedAt: "2026-06-10",
    closedAt: null,
  },
  {
    id: DEMO_IDS.purchaseOrders.closed,
    poNumber: "PO-1004",
    vendorId: DEMO_IDS.vendors.northstar,
    status: "closed",
    currency: "USD",
    orderedAt: "2026-05-01",
    closedAt: "2026-05-31",
  },
  {
    id: DEMO_IDS.purchaseOrders.missingContact,
    poNumber: "PO-1005",
    vendorId: DEMO_IDS.vendors.noContact,
    status: "open",
    currency: "USD",
    orderedAt: "2026-06-15",
    closedAt: null,
  },
  {
    id: DEMO_IDS.purchaseOrders.sharedAcme,
    poNumber: "PO-SHARED",
    vendorId: DEMO_IDS.vendors.acme,
    status: "open",
    currency: "USD",
    orderedAt: "2026-06-20",
    closedAt: null,
  },
  {
    id: DEMO_IDS.purchaseOrders.sharedNorthstar,
    poNumber: "PO-SHARED",
    vendorId: DEMO_IDS.vendors.northstar,
    status: "open",
    currency: "USD",
    orderedAt: "2026-06-21",
    closedAt: null,
  },
] as const;

export const DEMO_PURCHASE_ORDER_LINES = [
  {
    id: DEMO_IDS.lines.fullOne,
    purchaseOrderId: DEMO_IDS.purchaseOrders.fullyReceived,
    lineNumber: 1,
    description: "Steel fasteners",
    quantityOrdered: "10.0000",
    unitPrice: "5.2500",
  },
  {
    id: DEMO_IDS.lines.fullTwo,
    purchaseOrderId: DEMO_IDS.purchaseOrders.fullyReceived,
    lineNumber: 2,
    description: "Protective gloves",
    quantityOrdered: "4.0000",
    unitPrice: "12.5000",
  },
  {
    id: DEMO_IDS.lines.partial,
    purchaseOrderId: DEMO_IDS.purchaseOrders.partiallyReceived,
    lineNumber: 1,
    description: "Shop towels",
    quantityOrdered: "20.0000",
    unitPrice: "3.0000",
  },
  {
    id: DEMO_IDS.lines.noReceipt,
    purchaseOrderId: DEMO_IDS.purchaseOrders.noReceipts,
    lineNumber: 1,
    description: "Copy paper",
    quantityOrdered: "25.0000",
    unitPrice: "7.5000",
  },
  {
    id: DEMO_IDS.lines.closed,
    purchaseOrderId: DEMO_IDS.purchaseOrders.closed,
    lineNumber: 1,
    description: "Desk chair",
    quantityOrdered: "1.0000",
    unitPrice: "275.0000",
  },
  {
    id: DEMO_IDS.lines.missingContact,
    purchaseOrderId: DEMO_IDS.purchaseOrders.missingContact,
    lineNumber: 1,
    description: "Document scanning",
    quantityOrdered: "8.0000",
    unitPrice: "40.0000",
  },
  {
    id: DEMO_IDS.lines.sharedAcme,
    purchaseOrderId: DEMO_IDS.purchaseOrders.sharedAcme,
    lineNumber: 1,
    description: "Shared number fixture",
    quantityOrdered: "1.0000",
    unitPrice: "1.0000",
  },
  {
    id: DEMO_IDS.lines.sharedNorthstar,
    purchaseOrderId: DEMO_IDS.purchaseOrders.sharedNorthstar,
    lineNumber: 1,
    description: "Shared number fixture",
    quantityOrdered: "1.0000",
    unitPrice: "1.0000",
  },
] as const;

export const DEMO_RECEIVING_RECORDS = [
  {
    id: DEMO_IDS.receipts.full,
    purchaseOrderId: DEMO_IDS.purchaseOrders.fullyReceived,
    receiptNumber: "RCV-1001",
    receivedAt: "2026-06-08",
  },
  {
    id: DEMO_IDS.receipts.partial,
    purchaseOrderId: DEMO_IDS.purchaseOrders.partiallyReceived,
    receiptNumber: "RCV-1002",
    receivedAt: "2026-06-12",
  },
] as const;

export const DEMO_RECEIPT_LINES = [
  {
    id: "00000000-0000-4000-8000-000000003101",
    receivingRecordId: DEMO_IDS.receipts.full,
    purchaseOrderLineId: DEMO_IDS.lines.fullOne,
    quantityReceived: "10.0000",
  },
  {
    id: "00000000-0000-4000-8000-000000003102",
    receivingRecordId: DEMO_IDS.receipts.full,
    purchaseOrderLineId: DEMO_IDS.lines.fullTwo,
    quantityReceived: "4.0000",
  },
  {
    id: "00000000-0000-4000-8000-000000003103",
    receivingRecordId: DEMO_IDS.receipts.partial,
    purchaseOrderLineId: DEMO_IDS.lines.partial,
    quantityReceived: "8.0000",
  },
] as const;

export function buildDemoPurchaseOrderSearchSources(): PurchaseOrderSearchSource[] {
  return DEMO_PURCHASE_ORDERS.map((order) => {
    const vendor = DEMO_VENDORS.find((candidate) => candidate.id === order.vendorId);
    if (!vendor) {
      throw new Error(`Demo purchase order ${order.id} has no vendor.`);
    }

    return {
      purchaseOrder: {
        ...order,
        lines: DEMO_PURCHASE_ORDER_LINES.filter(
          (line) => line.purchaseOrderId === order.id,
        ).map((line) => ({
          id: line.id,
          lineNumber: line.lineNumber,
          description: line.description,
          quantityOrdered: line.quantityOrdered,
          unitPrice: line.unitPrice,
        })),
      },
      vendor: { ...vendor },
      aliases: DEMO_VENDOR_ALIASES.filter(
        (alias) => alias.vendorId === vendor.id,
      ).map((alias) => alias.alias),
    };
  });
}
