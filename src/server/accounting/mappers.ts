import type { PurchaseOrder, Vendor } from "@/server/accounting/service";
import {
  purchaseOrderLines,
  purchaseOrders,
  vendors,
} from "@/server/db/schema";

type PurchaseOrderRow = typeof purchaseOrders.$inferSelect;
type PurchaseOrderLineRow = typeof purchaseOrderLines.$inferSelect;
type VendorRow = typeof vendors.$inferSelect;

export function mapVendor(row: VendorRow): Vendor {
  return {
    id: row.id,
    vendorNumber: row.vendorNumber,
    legalName: row.legalName,
    displayName: row.displayName,
    taxId: row.taxId,
    apEmail: row.apEmail,
  };
}

export function mapPurchaseOrder(
  row: PurchaseOrderRow,
  lines: PurchaseOrderLineRow[],
): PurchaseOrder {
  return {
    id: row.id,
    poNumber: row.poNumber,
    vendorId: row.vendorId,
    status: row.status,
    currency: row.currency,
    orderedAt: row.orderedAt,
    closedAt: row.closedAt,
    lines: lines
      .filter((line) => line.purchaseOrderId === row.id)
      .sort((left, right) => left.lineNumber - right.lineNumber)
      .map((line) => ({
        id: line.id,
        lineNumber: line.lineNumber,
        description: line.description,
        quantityOrdered: line.quantityOrdered,
        unitPrice: line.unitPrice,
      })),
  };
}
