CREATE TYPE "public"."accounting_invoice_status" AS ENUM('remitted');--> statement-breakpoint
CREATE TYPE "public"."email_delivery_status" AS ENUM('sending', 'sent', 'failed', 'uncertain');--> statement-breakpoint
CREATE TYPE "public"."invoice_submission_status" AS ENUM('receiving', 'received', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('submitted');--> statement-breakpoint
CREATE TYPE "public"."purchase_order_status" AS ENUM('open', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_status" AS ENUM('queued', 'processing', 'awaiting_exception_review', 'awaiting_payment_approval', 'awaiting_email_approval', 'payment_submitted', 'dispute_sent', 'email_sent', 'cancelled', 'failed');--> statement-breakpoint
CREATE TABLE "accounting_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"purchase_order_line_id" uuid NOT NULL,
	"source_line_number" integer,
	"description" text NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounting_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reconciliation_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"invoice_number" varchar(255) NOT NULL,
	"invoice_date" date,
	"due_date" date,
	"currency" varchar(3) NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"status" "accounting_invoice_status" DEFAULT 'remitted' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reconciliation_id" uuid NOT NULL,
	"status" "email_delivery_status" NOT NULL,
	"message" jsonb NOT NULL,
	"provider_message_id" text,
	"accepted" jsonb,
	"rejected" jsonb,
	"failure_message" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "invoice_submission_status" DEFAULT 'receiving' NOT NULL,
	"failure_code" varchar(100),
	"failure_message" text,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"accounting_invoice_id" uuid NOT NULL,
	"reconciliation_id" uuid NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"status" "payment_status" DEFAULT 'submitted' NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"due_date" date,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"description" text NOT NULL,
	"quantity_ordered" numeric(18, 4) NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order_search_documents" (
	"purchase_order_id" uuid PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"embedding_model" varchar(100) NOT NULL,
	"embedding_dimensions" integer NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_number" varchar(100) NOT NULL,
	"vendor_id" uuid NOT NULL,
	"status" "purchase_order_status" NOT NULL,
	"currency" varchar(3) NOT NULL,
	"ordered_at" date NOT NULL,
	"closed_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receiving_record_id" uuid NOT NULL,
	"purchase_order_line_id" uuid NOT NULL,
	"quantity_received" numeric(18, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receiving_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"receipt_number" varchar(100) NOT NULL,
	"received_at" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receiving_records_receipt_number_unique" UNIQUE("receipt_number")
);
--> statement-breakpoint
CREATE TABLE "reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"status" "reconciliation_status" DEFAULT 'queued' NOT NULL,
	"failure_code" varchar(100),
	"failure_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"alias_normalized" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_number" varchar(100) NOT NULL,
	"legal_name" text NOT NULL,
	"legal_name_normalized" text NOT NULL,
	"display_name" text NOT NULL,
	"display_name_normalized" text NOT NULL,
	"tax_id" varchar(100),
	"tax_id_normalized" varchar(100),
	"ap_email" text,
	"ap_email_normalized" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendors_vendor_number_unique" UNIQUE("vendor_number")
);
--> statement-breakpoint
ALTER TABLE "accounting_invoice_lines" ADD CONSTRAINT "accounting_invoice_lines_invoice_id_accounting_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."accounting_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_invoice_lines" ADD CONSTRAINT "accounting_invoice_lines_purchase_order_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("purchase_order_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_invoices" ADD CONSTRAINT "accounting_invoices_reconciliation_id_reconciliations_id_fk" FOREIGN KEY ("reconciliation_id") REFERENCES "public"."reconciliations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_invoices" ADD CONSTRAINT "accounting_invoices_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_invoices" ADD CONSTRAINT "accounting_invoices_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_reconciliation_id_reconciliations_id_fk" FOREIGN KEY ("reconciliation_id") REFERENCES "public"."reconciliations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_documents" ADD CONSTRAINT "invoice_documents_submission_id_invoice_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."invoice_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_accounting_invoice_id_accounting_invoices_id_fk" FOREIGN KEY ("accounting_invoice_id") REFERENCES "public"."accounting_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reconciliation_id_reconciliations_id_fk" FOREIGN KEY ("reconciliation_id") REFERENCES "public"."reconciliations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_search_documents" ADD CONSTRAINT "purchase_order_search_documents_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_receiving_record_id_receiving_records_id_fk" FOREIGN KEY ("receiving_record_id") REFERENCES "public"."receiving_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_purchase_order_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("purchase_order_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_records" ADD CONSTRAINT "receiving_records_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_submission_id_invoice_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."invoice_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_aliases" ADD CONSTRAINT "vendor_aliases_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_invoice_lines_invoice_po_line_unique" ON "accounting_invoice_lines" USING btree ("invoice_id","purchase_order_line_id");--> statement-breakpoint
CREATE INDEX "accounting_invoice_lines_purchase_order_line_id_idx" ON "accounting_invoice_lines" USING btree ("purchase_order_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_invoices_reconciliation_id_unique" ON "accounting_invoices" USING btree ("reconciliation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_invoices_vendor_number_unique" ON "accounting_invoices" USING btree ("vendor_id","invoice_number");--> statement-breakpoint
CREATE INDEX "accounting_invoices_purchase_order_id_idx" ON "accounting_invoices" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_deliveries_reconciliation_id_unique" ON "email_deliveries" USING btree ("reconciliation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_documents_object_key_unique" ON "invoice_documents" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "invoice_documents_submission_id_idx" ON "invoice_documents" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "invoice_submissions_status_idx" ON "invoice_submissions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_accounting_invoice_id_unique" ON "payments" USING btree ("accounting_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_reconciliation_id_unique" ON "payments" USING btree ("reconciliation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idempotency_key_unique" ON "payments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_lines_po_line_unique" ON "purchase_order_lines" USING btree ("purchase_order_id","line_number");--> statement-breakpoint
CREATE INDEX "purchase_order_search_documents_model_idx" ON "purchase_order_search_documents" USING btree ("embedding_model","embedding_dimensions");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_vendor_number_unique" ON "purchase_orders" USING btree ("vendor_id","po_number");--> statement-breakpoint
CREATE INDEX "purchase_orders_po_number_idx" ON "purchase_orders" USING btree ("po_number");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_lines_receipt_po_line_unique" ON "receipt_lines" USING btree ("receiving_record_id","purchase_order_line_id");--> statement-breakpoint
CREATE INDEX "receiving_records_purchase_order_id_idx" ON "receiving_records" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliations_submission_id_unique" ON "reconciliations" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "reconciliations_status_idx" ON "reconciliations" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_aliases_vendor_alias_unique" ON "vendor_aliases" USING btree ("vendor_id","alias_normalized");--> statement-breakpoint
CREATE INDEX "vendor_aliases_alias_normalized_idx" ON "vendor_aliases" USING btree ("alias_normalized");--> statement-breakpoint
CREATE INDEX "vendors_legal_name_normalized_idx" ON "vendors" USING btree ("legal_name_normalized");--> statement-breakpoint
CREATE INDEX "vendors_display_name_normalized_idx" ON "vendors" USING btree ("display_name_normalized");--> statement-breakpoint
CREATE INDEX "vendors_tax_id_normalized_idx" ON "vendors" USING btree ("tax_id_normalized");--> statement-breakpoint
CREATE INDEX "vendors_ap_email_normalized_idx" ON "vendors" USING btree ("ap_email_normalized");