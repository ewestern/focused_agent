import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

import {
  compileInvoiceReconciliationGraph,
  type ReconciliationDependencies,
} from "@/server/agent/graph";
import { getAccountingService } from "@/server/accounting/postgres";
import { getDatabase } from "@/server/db/client";
import { getPool } from "@/server/db/pool";
import { LANGGRAPH_SCHEMA } from "@/server/db/setup";
import { getDocumentStore } from "@/server/documents/s3";
import { EmailDeliveryRepository } from "@/server/email/delivery";
import { getEmailService } from "@/server/email/smtp";
import { getServerEnv } from "@/server/env";
import { InvoiceSubmissionRepository } from "@/server/invoices/postgres-repository";
import {
  createAgentChatModel,
  LangChainInvoiceExtractor,
  LangChainInvoiceLineMatcher,
  LangChainVendorEmailDrafter,
} from "@/server/reconciliation/model-services";
import { ReconciliationRepository } from "@/server/reconciliation/repository";

declare global {
  var focusedInvoiceReconciliationGraph:
    ReturnType<typeof compileInvoiceReconciliationGraph> | undefined;
  var focusedReconciliationDependencies: ReconciliationDependencies | undefined;
}

export function getReconciliationGraph(): ReturnType<
  typeof compileInvoiceReconciliationGraph
> {
  if (!globalThis.focusedInvoiceReconciliationGraph) {
    const checkpointer = new PostgresSaver(getPool(), undefined, {
      schema: LANGGRAPH_SCHEMA,
    });
    globalThis.focusedInvoiceReconciliationGraph =
      compileInvoiceReconciliationGraph({ checkpointer });
  }
  return globalThis.focusedInvoiceReconciliationGraph;
}

export function getReconciliationDependencies(): ReconciliationDependencies {
  if (!globalThis.focusedReconciliationDependencies) {
    const env = getServerEnv();
    const model = createAgentChatModel(env);
    const db = getDatabase();
    globalThis.focusedReconciliationDependencies = {
      api: {
        accounting: getAccountingService(),
        documents: getDocumentStore(),
        submissions: new InvoiceSubmissionRepository(db),
        email: getEmailService(),
        emailDeliveries: new EmailDeliveryRepository(db),
      },
      llm: {
        invoiceExtraction: new LangChainInvoiceExtractor(
          model,
          env.AGENT_MODEL,
        ),
        invoiceLineMatching: new LangChainInvoiceLineMatcher(model),
        vendorEmailDrafting: new LangChainVendorEmailDrafter(model),
      },
      config: { emailFrom: env.SMTP_FROM },
    };
  }
  return globalThis.focusedReconciliationDependencies;
}

export function getReconciliationRepository(): ReconciliationRepository {
  return new ReconciliationRepository(getDatabase());
}
