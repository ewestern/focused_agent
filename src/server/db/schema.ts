import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
  varchar,
} from "drizzle-orm/pg-core";

import type {
  InvoiceDocument,
} from "@/lib/contracts";
import type {
  EmailDraft,
} from "@/server/reconciliation/types";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const invoiceSubmissionStatus = pgEnum("invoice_submission_status", [
  "receiving",
  "received",
  "failed",
]);
export const purchaseOrderStatus = pgEnum("purchase_order_status", [
  "open",
  "closed",
  "cancelled",
]);
export const reconciliationStatus = pgEnum("reconciliation_status", [
  "queued",
  "processing",
  "awaiting_exception_review",
  "awaiting_payment_approval",
  "awaiting_email_approval",
  "payment_submitted",
  "dispute_sent",
  "email_sent",
  "cancelled",
  "failed",
]);
export const accountingInvoiceStatus = pgEnum("accounting_invoice_status", [
  "remitted",
]);
export const paymentStatus = pgEnum("payment_status", ["submitted"]);
export const emailDeliveryStatus = pgEnum("email_delivery_status", [
  "sending",
  "sent",
  "failed",
  "uncertain",
]);

export const invoiceSubmissions = pgTable(
  "invoice_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: invoiceSubmissionStatus("status").notNull().default("receiving"),
    failureCode: varchar("failure_code", { length: 100 }),
    failureMessage: text("failure_message"),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("invoice_submissions_status_idx").on(table.status),
  ],
);

export const invoiceDocuments = pgTable(
  "invoice_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => invoiceSubmissions.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull(),
    originalFilename: text("original_filename").notNull(),
    contentType: varchar("content_type", { length: 100 })
      .$type<InvoiceDocument["contentType"]>()
      .notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("invoice_documents_object_key_unique").on(table.objectKey),
    index("invoice_documents_submission_id_idx").on(table.submissionId),
  ],
);

export const vendors = pgTable(
  "vendors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorNumber: varchar("vendor_number", { length: 100 }).notNull().unique(),
    legalName: text("legal_name").notNull(),
    legalNameNormalized: text("legal_name_normalized").notNull(),
    displayName: text("display_name").notNull(),
    displayNameNormalized: text("display_name_normalized").notNull(),
    taxId: varchar("tax_id", { length: 100 }),
    taxIdNormalized: varchar("tax_id_normalized", { length: 100 }),
    apEmail: text("ap_email"),
    apEmailNormalized: text("ap_email_normalized"),
    ...timestamps,
  },
  (table) => [
    index("vendors_legal_name_normalized_idx").on(table.legalNameNormalized),
    index("vendors_display_name_normalized_idx").on(table.displayNameNormalized),
    index("vendors_tax_id_normalized_idx").on(table.taxIdNormalized),
    index("vendors_ap_email_normalized_idx").on(table.apEmailNormalized),
  ],
);

export const vendorAliases = pgTable(
  "vendor_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    aliasNormalized: text("alias_normalized").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("vendor_aliases_vendor_alias_unique").on(
      table.vendorId,
      table.aliasNormalized,
    ),
    index("vendor_aliases_alias_normalized_idx").on(table.aliasNormalized),
  ],
);

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    poNumber: varchar("po_number", { length: 100 }).notNull(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id),
    status: purchaseOrderStatus("status").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    orderedAt: date("ordered_at").notNull(),
    closedAt: date("closed_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("purchase_orders_vendor_number_unique").on(
      table.vendorId,
      table.poNumber,
    ),
    index("purchase_orders_po_number_idx").on(table.poNumber),
  ],
);

export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    lineNumber: integer("line_number").notNull(),
    description: text("description").notNull(),
    quantityOrdered: numeric("quantity_ordered", {
      precision: 18,
      scale: 4,
    }).notNull(),
    unitPrice: numeric("unit_price", { precision: 18, scale: 4 }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("purchase_order_lines_po_line_unique").on(
      table.purchaseOrderId,
      table.lineNumber,
    ),
  ],
);

export const purchaseOrderSearchDocuments = pgTable(
  "purchase_order_search_documents",
  {
    purchaseOrderId: uuid("purchase_order_id")
      .primaryKey()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    embeddingModel: varchar("embedding_model", { length: 100 }).notNull(),
    embeddingDimensions: integer("embedding_dimensions").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    indexedAt: timestamp("indexed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("purchase_order_search_documents_model_idx").on(
      table.embeddingModel,
      table.embeddingDimensions,
    ),
  ],
);

export const receivingRecords = pgTable(
  "receiving_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    receiptNumber: varchar("receipt_number", { length: 100 }).notNull().unique(),
    receivedAt: date("received_at").notNull(),
    ...timestamps,
  },
  (table) => [index("receiving_records_purchase_order_id_idx").on(table.purchaseOrderId)],
);

export const receiptLines = pgTable(
  "receipt_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receivingRecordId: uuid("receiving_record_id")
      .notNull()
      .references(() => receivingRecords.id, { onDelete: "cascade" }),
    purchaseOrderLineId: uuid("purchase_order_line_id")
      .notNull()
      .references(() => purchaseOrderLines.id),
    quantityReceived: numeric("quantity_received", {
      precision: 18,
      scale: 4,
    }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("receipt_lines_receipt_po_line_unique").on(
      table.receivingRecordId,
      table.purchaseOrderLineId,
    ),
  ],
);

export const reconciliations = pgTable(
  "reconciliations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => invoiceSubmissions.id, { onDelete: "cascade" }),
    status: reconciliationStatus("status").notNull().default("queued"),
    failureCode: varchar("failure_code", { length: 100 }),
    failureMessage: text("failure_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("reconciliations_submission_id_unique").on(table.submissionId),
    index("reconciliations_status_idx").on(table.status),
  ],
);

export const accountingInvoices = pgTable(
  "accounting_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reconciliationId: uuid("reconciliation_id")
      .notNull()
      .references(() => reconciliations.id, { onDelete: "cascade" }),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id),
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id),
    invoiceNumber: varchar("invoice_number", { length: 255 }).notNull(),
    invoiceDate: date("invoice_date"),
    dueDate: date("due_date"),
    currency: varchar("currency", { length: 3 }).notNull(),
    amount: numeric("amount", { precision: 18, scale: 4 }).notNull(),
    status: accountingInvoiceStatus("status").notNull().default("remitted"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("accounting_invoices_reconciliation_id_unique").on(
      table.reconciliationId,
    ),
    uniqueIndex("accounting_invoices_vendor_number_unique").on(
      table.vendorId,
      table.invoiceNumber,
    ),
    index("accounting_invoices_purchase_order_id_idx").on(
      table.purchaseOrderId,
    ),
  ],
);

export const accountingInvoiceLines = pgTable(
  "accounting_invoice_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => accountingInvoices.id, { onDelete: "cascade" }),
    purchaseOrderLineId: uuid("purchase_order_line_id")
      .notNull()
      .references(() => purchaseOrderLines.id),
    sourceLineNumber: integer("source_line_number"),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 18, scale: 4 }).notNull(),
    amount: numeric("amount", { precision: 18, scale: 4 }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("accounting_invoice_lines_invoice_po_line_unique").on(
      table.invoiceId,
      table.purchaseOrderLineId,
    ),
    index("accounting_invoice_lines_purchase_order_line_id_idx").on(
      table.purchaseOrderLineId,
    ),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountingInvoiceId: uuid("accounting_invoice_id")
      .notNull()
      .references(() => accountingInvoices.id),
    reconciliationId: uuid("reconciliation_id")
      .notNull()
      .references(() => reconciliations.id, { onDelete: "cascade" }),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    status: paymentStatus("status").notNull().default("submitted"),
    amount: numeric("amount", { precision: 18, scale: 4 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    dueDate: date("due_date"),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("payments_accounting_invoice_id_unique").on(
      table.accountingInvoiceId,
    ),
    uniqueIndex("payments_reconciliation_id_unique").on(table.reconciliationId),
    uniqueIndex("payments_idempotency_key_unique").on(table.idempotencyKey),
  ],
);

export const emailDeliveries = pgTable(
  "email_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reconciliationId: uuid("reconciliation_id")
      .notNull()
      .references(() => reconciliations.id, { onDelete: "cascade" }),
    status: emailDeliveryStatus("status").notNull(),
    message: jsonb("message").$type<EmailDraft>().notNull(),
    providerMessageId: text("provider_message_id"),
    accepted: jsonb("accepted").$type<string[]>(),
    rejected: jsonb("rejected").$type<string[]>(),
    failureMessage: text("failure_message"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("email_deliveries_reconciliation_id_unique").on(
      table.reconciliationId,
    ),
  ],
);
