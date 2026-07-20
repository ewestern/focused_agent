import type { AppDatabase } from "@/server/db/client";
import {
  normalizeEmail,
  normalizeName,
  normalizeTaxId,
} from "@/server/accounting/normalize";
import {
  purchaseOrderLines,
  purchaseOrders,
  receiptLines,
  receivingRecords,
  vendorAliases,
  vendors,
} from "@/server/db/schema";

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

export const UNKNOWN_VENDOR_LOOKUP = { vendorNumber: "V-DOES-NOT-EXIST" } as const;

export async function seedDemoData(db: AppDatabase): Promise<void> {
  const vendorValues = [
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
  ];
  for (const vendor of vendorValues) {
    await db
      .insert(vendors)
      .values({
        ...vendor,
        legalNameNormalized: normalizeName(vendor.legalName),
        displayNameNormalized: normalizeName(vendor.displayName),
        taxIdNormalized: normalizeTaxId(vendor.taxId),
        apEmailNormalized: vendor.apEmail ? normalizeEmail(vendor.apEmail) : null,
      })
      .onConflictDoUpdate({
        target: vendors.id,
        set: {
          vendorNumber: vendor.vendorNumber,
          legalName: vendor.legalName,
          legalNameNormalized: normalizeName(vendor.legalName),
          displayName: vendor.displayName,
          displayNameNormalized: normalizeName(vendor.displayName),
          taxId: vendor.taxId,
          taxIdNormalized: normalizeTaxId(vendor.taxId),
          apEmail: vendor.apEmail,
          apEmailNormalized: vendor.apEmail ? normalizeEmail(vendor.apEmail) : null,
          updatedAt: new Date(),
        },
      });
  }

  const aliases = [
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
  ];
  for (const alias of aliases) {
    await db
      .insert(vendorAliases)
      .values({ ...alias, aliasNormalized: normalizeName(alias.alias) })
      .onConflictDoUpdate({
        target: vendorAliases.id,
        set: {
          vendorId: alias.vendorId,
          alias: alias.alias,
          aliasNormalized: normalizeName(alias.alias),
          updatedAt: new Date(),
        },
      });
  }

  const orders = [
    {
      id: DEMO_IDS.purchaseOrders.fullyReceived,
      poNumber: "PO-1001",
      vendorId: DEMO_IDS.vendors.acme,
      status: "open" as const,
      currency: "USD",
      orderedAt: "2026-06-01",
      closedAt: null,
    },
    {
      id: DEMO_IDS.purchaseOrders.partiallyReceived,
      poNumber: "PO-1002",
      vendorId: DEMO_IDS.vendors.acme,
      status: "open" as const,
      currency: "USD",
      orderedAt: "2026-06-05",
      closedAt: null,
    },
    {
      id: DEMO_IDS.purchaseOrders.noReceipts,
      poNumber: "PO-1003",
      vendorId: DEMO_IDS.vendors.northstar,
      status: "open" as const,
      currency: "USD",
      orderedAt: "2026-06-10",
      closedAt: null,
    },
    {
      id: DEMO_IDS.purchaseOrders.closed,
      poNumber: "PO-1004",
      vendorId: DEMO_IDS.vendors.northstar,
      status: "closed" as const,
      currency: "USD",
      orderedAt: "2026-05-01",
      closedAt: "2026-05-31",
    },
    {
      id: DEMO_IDS.purchaseOrders.missingContact,
      poNumber: "PO-1005",
      vendorId: DEMO_IDS.vendors.noContact,
      status: "open" as const,
      currency: "USD",
      orderedAt: "2026-06-15",
      closedAt: null,
    },
    {
      id: DEMO_IDS.purchaseOrders.sharedAcme,
      poNumber: "PO-SHARED",
      vendorId: DEMO_IDS.vendors.acme,
      status: "open" as const,
      currency: "USD",
      orderedAt: "2026-06-20",
      closedAt: null,
    },
    {
      id: DEMO_IDS.purchaseOrders.sharedNorthstar,
      poNumber: "PO-SHARED",
      vendorId: DEMO_IDS.vendors.northstar,
      status: "open" as const,
      currency: "USD",
      orderedAt: "2026-06-21",
      closedAt: null,
    },
  ];
  for (const order of orders) {
    await db.insert(purchaseOrders).values(order).onConflictDoUpdate({
      target: purchaseOrders.id,
      set: { ...order, updatedAt: new Date() },
    });
  }

  const lines = [
    [DEMO_IDS.lines.fullOne, DEMO_IDS.purchaseOrders.fullyReceived, 1, "Steel fasteners", "10.0000", "5.2500"],
    [DEMO_IDS.lines.fullTwo, DEMO_IDS.purchaseOrders.fullyReceived, 2, "Protective gloves", "4.0000", "12.5000"],
    [DEMO_IDS.lines.partial, DEMO_IDS.purchaseOrders.partiallyReceived, 1, "Shop towels", "20.0000", "3.0000"],
    [DEMO_IDS.lines.noReceipt, DEMO_IDS.purchaseOrders.noReceipts, 1, "Copy paper", "25.0000", "7.5000"],
    [DEMO_IDS.lines.closed, DEMO_IDS.purchaseOrders.closed, 1, "Desk chair", "1.0000", "275.0000"],
    [DEMO_IDS.lines.missingContact, DEMO_IDS.purchaseOrders.missingContact, 1, "Document scanning", "8.0000", "40.0000"],
    [DEMO_IDS.lines.sharedAcme, DEMO_IDS.purchaseOrders.sharedAcme, 1, "Shared number fixture", "1.0000", "1.0000"],
    [DEMO_IDS.lines.sharedNorthstar, DEMO_IDS.purchaseOrders.sharedNorthstar, 1, "Shared number fixture", "1.0000", "1.0000"],
  ] as const;
  for (const [id, purchaseOrderId, lineNumber, description, quantityOrdered, unitPrice] of lines) {
    await db
      .insert(purchaseOrderLines)
      .values({ id, purchaseOrderId, lineNumber, description, quantityOrdered, unitPrice })
      .onConflictDoUpdate({
        target: purchaseOrderLines.id,
        set: { purchaseOrderId, lineNumber, description, quantityOrdered, unitPrice, updatedAt: new Date() },
      });
  }

  const receipts = [
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
  ];
  for (const receipt of receipts) {
    await db.insert(receivingRecords).values(receipt).onConflictDoUpdate({
      target: receivingRecords.id,
      set: { ...receipt, updatedAt: new Date() },
    });
  }

  const receivedLines = [
    ["00000000-0000-4000-8000-000000003101", DEMO_IDS.receipts.full, DEMO_IDS.lines.fullOne, "10.0000"],
    ["00000000-0000-4000-8000-000000003102", DEMO_IDS.receipts.full, DEMO_IDS.lines.fullTwo, "4.0000"],
    ["00000000-0000-4000-8000-000000003103", DEMO_IDS.receipts.partial, DEMO_IDS.lines.partial, "8.0000"],
  ] as const;
  for (const [id, receivingRecordId, purchaseOrderLineId, quantityReceived] of receivedLines) {
    await db
      .insert(receiptLines)
      .values({ id, receivingRecordId, purchaseOrderLineId, quantityReceived })
      .onConflictDoUpdate({
        target: receiptLines.id,
        set: { receivingRecordId, purchaseOrderLineId, quantityReceived, updatedAt: new Date() },
      });
  }
}
