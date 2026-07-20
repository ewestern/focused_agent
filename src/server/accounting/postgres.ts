import { and, eq, inArray, or, sql, sum, type SQL } from "drizzle-orm";

import type { AppDatabase } from "@/server/db/client";
import { getDatabase } from "@/server/db/client";
import {
  accountingInvoiceLines,
  accountingInvoices,
  payments as paymentRecords,
  purchaseOrderLines,
  purchaseOrders,
  receiptLines,
  receivingRecords,
  vendorAliases,
  vendors,
} from "@/server/db/schema";
import {
  normalizeEmail,
  normalizeName,
  normalizeTaxId,
  normalizeVendorNumber,
} from "@/server/accounting/normalize";
import { mapPurchaseOrder, mapVendor } from "@/server/accounting/mappers";
import { PostgresPurchaseOrderSearch } from "@/server/accounting/purchase-order-search";
import { RemittanceConflictError } from "@/server/accounting/service";
import { parseDecimal } from "@/server/decimal";
import type {
  AccountingService,
  AccountingInvoice,
  InvoicedQuantity,
  LookupResult,
  Payment,
  PurchaseOrder,
  PurchaseOrderLookup,
  PurchaseOrderSemanticMatch,
  PurchaseOrderSemanticQuery,
  ReceivingRecord,
  RemitPaymentInput,
  Vendor,
  VendorCandidate,
  VendorLookup,
  VendorMatchField,
} from "@/server/accounting/service";

export class PostgresAccountingService implements AccountingService {
  constructor(
    private readonly db: AppDatabase,
    private readonly purchaseOrderSearch = new PostgresPurchaseOrderSearch(db),
  ) {}

  async findVendorCandidates(query: VendorLookup): Promise<VendorCandidate[]> {
    const conditions: SQL[] = [];
    const normalizedVendorNumber = query.vendorNumber
      ? normalizeVendorNumber(query.vendorNumber)
      : undefined;
    const normalizedTaxId = query.taxId ? normalizeTaxId(query.taxId) : undefined;
    const normalizedEmail = query.email ? normalizeEmail(query.email) : undefined;
    const normalizedName = query.name ? normalizeName(query.name) : undefined;

    if (normalizedVendorNumber) {
      conditions.push(eq(vendors.vendorNumber, normalizedVendorNumber));
    }
    if (normalizedTaxId) {
      conditions.push(eq(vendors.taxIdNormalized, normalizedTaxId));
    }
    if (normalizedEmail) {
      conditions.push(eq(vendors.apEmailNormalized, normalizedEmail));
    }
    if (normalizedName) {
      conditions.push(eq(vendors.legalNameNormalized, normalizedName));
      conditions.push(eq(vendors.displayNameNormalized, normalizedName));
    }

    const matchedVendorRows = conditions.length
      ? await this.db.select().from(vendors).where(or(...conditions))
      : [];

    const aliasRows = normalizedName
      ? await this.db
          .select({ vendorId: vendorAliases.vendorId })
          .from(vendorAliases)
          .where(eq(vendorAliases.aliasNormalized, normalizedName))
      : [];
    const missingAliasVendorIds = aliasRows
      .map((row) => row.vendorId)
      .filter((id) => !matchedVendorRows.some((vendor) => vendor.id === id));
    const aliasVendors = missingAliasVendorIds.length
      ? await this.db
          .select()
          .from(vendors)
          .where(inArray(vendors.id, missingAliasVendorIds))
      : [];

    const allRows = [...matchedVendorRows, ...aliasVendors];
    return allRows
      .map((row): VendorCandidate => {
        const matchedOn: VendorMatchField[] = [];
        if (normalizedVendorNumber === row.vendorNumber) matchedOn.push("vendorNumber");
        if (normalizedTaxId === row.taxIdNormalized) matchedOn.push("taxId");
        if (normalizedEmail === row.apEmailNormalized) matchedOn.push("email");
        if (normalizedName === row.legalNameNormalized) matchedOn.push("legalName");
        if (normalizedName === row.displayNameNormalized) matchedOn.push("displayName");
        if (aliasRows.some((alias) => alias.vendorId === row.id)) matchedOn.push("alias");
        return { ...mapVendor(row), matchedOn };
      })
      .sort((left, right) => left.vendorNumber.localeCompare(right.vendorNumber));
  }

  async getVendor(id: string): Promise<Vendor | null> {
    const [row] = await this.db.select().from(vendors).where(eq(vendors.id, id)).limit(1);
    return row ? mapVendor(row) : null;
  }

  async findPurchaseOrder(
    query: PurchaseOrderLookup,
  ): Promise<LookupResult<PurchaseOrder>> {
    const condition = query.vendorId
      ? and(
          eq(purchaseOrders.poNumber, normalizeVendorNumber(query.poNumber)),
          eq(purchaseOrders.vendorId, query.vendorId),
        )
      : eq(purchaseOrders.poNumber, normalizeVendorNumber(query.poNumber));
    const rows = await this.db.select().from(purchaseOrders).where(condition);
    if (rows.length === 0) return { status: "not_found" };

    const ids = rows.map((row) => row.id);
    const lines = await this.db
      .select()
      .from(purchaseOrderLines)
      .where(inArray(purchaseOrderLines.purchaseOrderId, ids));
    const matches = rows.map((row) => mapPurchaseOrder(row, lines));
    return matches.length === 1
      ? { status: "found", value: matches[0] }
      : { status: "ambiguous", matches };
  }

  async searchPurchaseOrders(
    query: PurchaseOrderSemanticQuery,
  ): Promise<PurchaseOrderSemanticMatch[]> {
    return this.purchaseOrderSearch.searchPurchaseOrders(query);
  }

  async getReceivingRecords(purchaseOrderId: string): Promise<ReceivingRecord[]> {
    const records = await this.db
      .select()
      .from(receivingRecords)
      .where(eq(receivingRecords.purchaseOrderId, purchaseOrderId));
    if (records.length === 0) return [];
    const lines = await this.db
      .select()
      .from(receiptLines)
      .where(
        inArray(
          receiptLines.receivingRecordId,
          records.map((record) => record.id),
        ),
      );
    return records
      .sort((left, right) => left.receivedAt.localeCompare(right.receivedAt))
      .map((record) => ({
        id: record.id,
        purchaseOrderId: record.purchaseOrderId,
        receiptNumber: record.receiptNumber,
        receivedAt: record.receivedAt,
        lines: lines
          .filter((line) => line.receivingRecordId === record.id)
          .map((line) => ({
            id: line.id,
            purchaseOrderLineId: line.purchaseOrderLineId,
            quantityReceived: line.quantityReceived,
          })),
      }));
  }

  async getInvoice(query: {
    vendorId: string;
    invoiceNumber: string;
  }): Promise<AccountingInvoice | null> {
    const [row] = await this.db
      .select()
      .from(accountingInvoices)
      .where(
        and(
          eq(accountingInvoices.vendorId, query.vendorId),
          eq(accountingInvoices.invoiceNumber, query.invoiceNumber),
        ),
      )
      .limit(1);
    return row
      ? {
          id: row.id,
          reconciliationId: row.reconciliationId,
          vendorId: row.vendorId,
          purchaseOrderId: row.purchaseOrderId,
          invoiceNumber: row.invoiceNumber,
          invoiceDate: row.invoiceDate,
          dueDate: row.dueDate,
          currency: row.currency,
          amount: row.amount,
          status: row.status,
        }
      : null;
  }

  async getInvoicedQuantities(
    purchaseOrderId: string,
  ): Promise<InvoicedQuantity[]> {
    const rows = await this.db
      .select({
        purchaseOrderLineId: accountingInvoiceLines.purchaseOrderLineId,
        quantityInvoiced: sum(accountingInvoiceLines.quantity),
      })
      .from(accountingInvoiceLines)
      .innerJoin(
        accountingInvoices,
        eq(accountingInvoices.id, accountingInvoiceLines.invoiceId),
      )
      .where(eq(accountingInvoices.purchaseOrderId, purchaseOrderId))
      .groupBy(accountingInvoiceLines.purchaseOrderLineId);
    return rows.map((row) => ({
      purchaseOrderLineId: row.purchaseOrderLineId,
      quantityInvoiced: row.quantityInvoiced ?? "0",
    }));
  }

  async remitPayment(input: RemitPaymentInput): Promise<Payment> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${input.purchaseOrderId}))`,
      );
      const [existingPayment] = await tx
        .select()
        .from(paymentRecords)
        .where(eq(paymentRecords.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existingPayment) return mapPayment(existingPayment);

      const [duplicate] = await tx
        .select({ id: accountingInvoices.id })
        .from(accountingInvoices)
        .where(
          and(
            eq(accountingInvoices.vendorId, input.vendorId),
            eq(accountingInvoices.invoiceNumber, input.invoiceNumber),
          ),
        )
        .limit(1);
      if (duplicate) {
        throw new RemittanceConflictError(
          "duplicate_invoice",
          "The vendor invoice number has already been remitted.",
        );
      }

      const [purchaseOrder] = await tx
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, input.purchaseOrderId))
        .for("update")
        .limit(1);
      if (
        !purchaseOrder ||
        purchaseOrder.vendorId !== input.vendorId ||
        purchaseOrder.status !== "open" ||
        purchaseOrder.currency !== input.currency
      ) {
        throw new RemittanceConflictError(
          "purchase_order_changed",
          "Purchase-order ownership, status, or currency changed before remittance.",
        );
      }
      const currentPurchaseOrderLines = await tx
        .select()
        .from(purchaseOrderLines)
        .where(eq(purchaseOrderLines.purchaseOrderId, input.purchaseOrderId))
        .for("update");

      const receiptRows = await tx
        .select({
          purchaseOrderLineId: receiptLines.purchaseOrderLineId,
          quantityReceived: sum(receiptLines.quantityReceived),
        })
        .from(receiptLines)
        .innerJoin(
          receivingRecords,
          eq(receivingRecords.id, receiptLines.receivingRecordId),
        )
        .where(eq(receivingRecords.purchaseOrderId, input.purchaseOrderId))
        .groupBy(receiptLines.purchaseOrderLineId);
      const invoicedRows = await tx
        .select({
          purchaseOrderLineId: accountingInvoiceLines.purchaseOrderLineId,
          quantityInvoiced: sum(accountingInvoiceLines.quantity),
        })
        .from(accountingInvoiceLines)
        .innerJoin(
          accountingInvoices,
          eq(accountingInvoices.id, accountingInvoiceLines.invoiceId),
        )
        .where(eq(accountingInvoices.purchaseOrderId, input.purchaseOrderId))
        .groupBy(accountingInvoiceLines.purchaseOrderLineId);
      for (const line of input.lines) {
        const purchaseOrderLine = currentPurchaseOrderLines.find(
          (candidate) => candidate.id === line.purchaseOrderLineId,
        );
        if (
          !purchaseOrderLine ||
          parseDecimal(purchaseOrderLine.unitPrice) !== parseDecimal(line.unitPrice)
        ) {
          throw new RemittanceConflictError(
            "purchase_order_changed",
            "A purchase-order line or unit price changed before remittance.",
          );
        }
        const received = parseDecimal(
          receiptRows.find((row) => row.purchaseOrderLineId === line.purchaseOrderLineId)
            ?.quantityReceived ?? "0",
        );
        const invoiced = parseDecimal(
          invoicedRows.find((row) => row.purchaseOrderLineId === line.purchaseOrderLineId)
            ?.quantityInvoiced ?? "0",
        );
        if (
          invoiced + parseDecimal(line.quantity) >
          parseDecimal(purchaseOrderLine.quantityOrdered)
        ) {
          throw new RemittanceConflictError(
            "purchase_order_changed",
            "The invoiced quantity now exceeds the purchase-order quantity.",
          );
        }
        if (parseDecimal(line.quantity) > received - invoiced) {
          throw new RemittanceConflictError(
            "insufficient_received_quantity",
            "Received, previously unbilled quantity changed before remittance.",
          );
        }
      }

      const [invoice] = await tx
        .insert(accountingInvoices)
        .values({
          reconciliationId: input.reconciliationId,
          vendorId: input.vendorId,
          purchaseOrderId: input.purchaseOrderId,
          invoiceNumber: input.invoiceNumber,
          invoiceDate: input.invoiceDate,
          dueDate: input.dueDate,
          currency: input.currency,
          amount: input.amount,
        })
        .returning();
      if (!invoice) throw new Error("Accounting invoice could not be created.");
      await tx.insert(accountingInvoiceLines).values(
        input.lines.map((line) => ({
          invoiceId: invoice.id,
          ...line,
        })),
      );
      const [payment] = await tx
        .insert(paymentRecords)
        .values({
          accountingInvoiceId: invoice.id,
          reconciliationId: input.reconciliationId,
          idempotencyKey: input.idempotencyKey,
          amount: input.amount,
          currency: input.currency,
          dueDate: input.dueDate,
        })
        .returning();
      if (!payment) throw new Error("Payment could not be created.");
      return mapPayment(payment);
    });
  }
}

function mapPayment(row: typeof paymentRecords.$inferSelect): Payment {
  return {
    id: row.id,
    accountingInvoiceId: row.accountingInvoiceId,
    reconciliationId: row.reconciliationId,
    idempotencyKey: row.idempotencyKey,
    status: row.status,
    amount: row.amount,
    currency: row.currency,
    dueDate: row.dueDate,
    submittedAt: row.submittedAt.toISOString(),
  };
}

let sharedService: PostgresAccountingService | undefined;

export function getAccountingService(): PostgresAccountingService {
  sharedService ??= new PostgresAccountingService(getDatabase());
  return sharedService;
}
