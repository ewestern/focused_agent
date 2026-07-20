import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

import {
  compileInvoiceReconciliationGraph,
  type ReconciliationServices,
} from "@/server/agent/graph";
import { getAccountingService } from "@/server/accounting/postgres";
import { getDatabase } from "@/server/db/client";
import { getPool } from "@/server/db/pool";
import { LANGGRAPH_SCHEMA } from "@/server/db/setup";
import { getDocumentStore } from "@/server/documents/s3";
import { getEmailService } from "@/server/email/smtp";
import { getServerEnv } from "@/server/env";
import { InvoiceSubmissionRepository } from "@/server/invoices/postgres-repository";
import {
  createAgentChatModel,
  LangChainDisputeEmailComposer,
  LangChainInvoiceExtractor,
  LangChainInvoiceLineMatcher,
} from "@/server/reconciliation/model-services";
import { ReconciliationRepository } from "@/server/reconciliation/repository";

declare global {
  var focusedInvoiceReconciliationGraph:
    | ReturnType<typeof compileInvoiceReconciliationGraph>
    | undefined;
  var focusedReconciliationServices: ReconciliationServices | undefined;
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

export function getReconciliationServices(): ReconciliationServices {
  if (!globalThis.focusedReconciliationServices) {
    const env = getServerEnv();
    const model = createAgentChatModel(env);
    const db = getDatabase();
    globalThis.focusedReconciliationServices = {
      accounting: getAccountingService(),
      documents: getDocumentStore(),
      submissions: new InvoiceSubmissionRepository(db),
      reconciliations: new ReconciliationRepository(db),
      extractor: new LangChainInvoiceExtractor(model, env.AGENT_MODEL),
      lineMatcher: new LangChainInvoiceLineMatcher(model),
      emailComposer: new LangChainDisputeEmailComposer(model),
      email: getEmailService(),
      emailFrom: env.SMTP_FROM,
    };
  }
  return globalThis.focusedReconciliationServices;
}
