import {
  normalizeEmail,
  normalizeName,
  normalizeTaxId,
} from "@/server/accounting/normalize";
import type { AppDatabase } from "@/server/db/client";
import {
  DEMO_PURCHASE_ORDER_LINES,
  DEMO_PURCHASE_ORDERS,
  DEMO_RECEIPT_LINES,
  DEMO_RECEIVING_RECORDS,
  DEMO_VENDOR_ALIASES,
  DEMO_VENDORS,
} from "@/server/db/demo-data";
import { getDemoPurchaseOrderSearchDocuments } from "@/server/db/demo-purchase-order-embeddings";
import {
  purchaseOrderLines,
  purchaseOrders,
  purchaseOrderSearchDocuments,
  receiptLines,
  receivingRecords,
  vendorAliases,
  vendors,
} from "@/server/db/schema";

export { DEMO_IDS, UNKNOWN_VENDOR_LOOKUP } from "@/server/db/demo-data";

export async function seedDemoData(db: AppDatabase): Promise<void> {
  const searchDocuments = getDemoPurchaseOrderSearchDocuments();

  await db.transaction(async (transaction) => {
    for (const vendor of DEMO_VENDORS) {
      await transaction
        .insert(vendors)
        .values({
          ...vendor,
          legalNameNormalized: normalizeName(vendor.legalName),
          displayNameNormalized: normalizeName(vendor.displayName),
          taxIdNormalized: normalizeTaxId(vendor.taxId),
          apEmailNormalized: vendor.apEmail
            ? normalizeEmail(vendor.apEmail)
            : null,
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
            apEmailNormalized: vendor.apEmail
              ? normalizeEmail(vendor.apEmail)
              : null,
            updatedAt: new Date(),
          },
        });
    }

    for (const alias of DEMO_VENDOR_ALIASES) {
      await transaction
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

    for (const order of DEMO_PURCHASE_ORDERS) {
      await transaction
        .insert(purchaseOrders)
        .values(order)
        .onConflictDoUpdate({
          target: purchaseOrders.id,
          set: { ...order, updatedAt: new Date() },
        });
    }

    for (const line of DEMO_PURCHASE_ORDER_LINES) {
      await transaction
        .insert(purchaseOrderLines)
        .values(line)
        .onConflictDoUpdate({
          target: purchaseOrderLines.id,
          set: { ...line, updatedAt: new Date() },
        });
    }

    for (const receipt of DEMO_RECEIVING_RECORDS) {
      await transaction
        .insert(receivingRecords)
        .values(receipt)
        .onConflictDoUpdate({
          target: receivingRecords.id,
          set: { ...receipt, updatedAt: new Date() },
        });
    }

    for (const line of DEMO_RECEIPT_LINES) {
      await transaction
        .insert(receiptLines)
        .values(line)
        .onConflictDoUpdate({
          target: receiptLines.id,
          set: { ...line, updatedAt: new Date() },
        });
    }

    for (const document of searchDocuments) {
      await transaction
        .insert(purchaseOrderSearchDocuments)
        .values({ ...document, indexedAt: new Date() })
        .onConflictDoUpdate({
          target: purchaseOrderSearchDocuments.purchaseOrderId,
          set: { ...document, indexedAt: new Date() },
        });
    }
  });
}
