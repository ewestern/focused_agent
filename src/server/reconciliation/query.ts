import type { StateSnapshot } from "@langchain/langgraph";

import {
  getReconciliationGraph,
  getReconciliationRepository,
} from "@/server/agent/runtime";
import type { ReconciliationGraphState } from "@/server/agent/graph";
import type {
  PurchaseOrder,
  PurchaseOrderSemanticMatch,
  ReceivingRecord,
  VendorCandidate,
} from "@/server/accounting/service";
import { getDatabase } from "@/server/db/client";
import { EmailDeliveryRepository } from "@/server/email/delivery";
import { InvoiceSubmissionRepository } from "@/server/invoices/postgres-repository";
import type {
  ExtractedInvoice,
  InvoiceLineMatch,
  PolicyDiscrepancy,
  ReconciliationStatus,
  ReviewRequest,
  VendorEmail,
} from "@/server/reconciliation/types";

export type ReconciliationSummary = {
  id: string;
  submissionId: string;
  status: ReconciliationStatus;
  stage: string;
  originalFilename: string | null;
  invoiceNumber: string | null;
  vendorName: string | null;
  total: string | null;
  currency: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CheckpointHistoryItem = {
  checkpointId: string;
  createdAt: string | null;
  step: number | null;
  nodes: string[];
  next: string[];
};

export type ReconciliationDetail = ReconciliationSummary & {
  checkpointId: string | null;
  extractionModel: string | null;
  extraction: ExtractedInvoice | null;
  selectedVendorId: string | null;
  selectedPurchaseOrderId: string | null;
  vendorCandidates: VendorCandidate[];
  purchaseOrderCandidates: Array<PurchaseOrder | PurchaseOrderSemanticMatch>;
  receivingSnapshot: ReceivingRecord[];
  lineMatches: InvoiceLineMatch[];
  discrepancies: PolicyDiscrepancy[];
  vendorEmail: VendorEmail | null;
  failureCode: string | null;
  failureMessage: string | null;
  pendingReview: ReviewRequest | null;
  checkpointHistory: CheckpointHistoryItem[];
  payment: { id: string; status: string; submittedAt: string } | null;
  emailDelivery: { id: string; status: string; sentAt: string | null } | null;
};

export class ReconciliationQueryService {
  private readonly graph = getReconciliationGraph();

  constructor(
    private readonly runs = getReconciliationRepository(),
    private readonly submissions = new InvoiceSubmissionRepository(
      getDatabase(),
    ),
    private readonly emailDeliveries = new EmailDeliveryRepository(
      getDatabase(),
    ),
  ) {}

  async list(): Promise<ReconciliationSummary[]> {
    const rows = await this.runs.listRuns();
    return Promise.all(
      rows.map(async (row) => {
        const snapshot = await this.graph.getState(config(row.id));
        return mapSummary(row, graphState(snapshot), snapshot.next);
      }),
    );
  }

  async getDetail(id: string): Promise<ReconciliationDetail | null> {
    const run = await this.runs.getCore(id);
    if (!run) return null;
    const snapshot = await this.graph.getState(config(id));
    const state = graphState(snapshot);
    const [source, payment, emailDelivery, checkpointHistory] =
      await Promise.all([
        this.submissions.getForProcessing(run.submissionId),
        this.runs.getPaymentSummary(id),
        this.emailDeliveries.getSummary(id),
        this.readHistory(id),
      ]);
    return {
      ...mapSummary(
        {
          ...run,
          originalFilename: source?.documents[0]?.originalFilename ?? null,
        },
        state,
        snapshot.next,
      ),
      checkpointId: readCheckpointId(snapshot),
      extractionModel: state.extractionModel ?? null,
      extraction: state.extraction ?? null,
      selectedVendorId: state.selectedVendor?.id ?? null,
      selectedPurchaseOrderId: state.selectedPurchaseOrder?.id ?? null,
      vendorCandidates: state.vendorCandidates ?? [],
      purchaseOrderCandidates: state.purchaseOrderCandidates ?? [],
      receivingSnapshot: state.receivingRecords ?? [],
      lineMatches: state.lineMatches ?? [],
      discrepancies: state.discrepancies ?? [],
      vendorEmail: state.vendorEmail ?? null,
      failureCode: run.failureCode,
      failureMessage: run.failureMessage,
      pendingReview: state.pendingReview ?? null,
      checkpointHistory,
      payment,
      emailDelivery,
    };
  }

  async getCurrentState(id: string): Promise<{
    checkpointId: string | null;
    state: ReconciliationGraphState;
  } | null> {
    if (!(await this.runs.getCore(id))) return null;
    const snapshot = await this.graph.getState(config(id));
    return {
      checkpointId: readCheckpointId(snapshot),
      state: graphState(snapshot),
    };
  }

  private async readHistory(id: string): Promise<CheckpointHistoryItem[]> {
    const history: CheckpointHistoryItem[] = [];
    for await (const snapshot of this.graph.getStateHistory(config(id), {
      limit: 50,
    })) {
      const checkpointId = readCheckpointId(snapshot);
      if (!checkpointId) continue;
      history.push({
        checkpointId,
        createdAt: snapshot.createdAt ?? null,
        step:
          typeof snapshot.metadata?.step === "number"
            ? snapshot.metadata.step
            : null,
        nodes: writtenNodes(snapshot.metadata),
        next: [...snapshot.next],
      });
    }
    return history;
  }
}

function config(id: string) {
  return { configurable: { thread_id: id } };
}

function graphState(snapshot: StateSnapshot): ReconciliationGraphState {
  return snapshot.values as ReconciliationGraphState;
}

function readCheckpointId(snapshot: StateSnapshot): string | null {
  const value = snapshot.config.configurable?.checkpoint_id;
  return typeof value === "string" ? value : null;
}

function writtenNodes(metadata: StateSnapshot["metadata"]): string[] {
  if (!metadata || !("writes" in metadata) || !metadata.writes) return [];
  if (typeof metadata.writes !== "object" || Array.isArray(metadata.writes))
    return [];
  return Object.keys(metadata.writes).filter((node) => node !== "__start__");
}

function currentStage(
  status: ReconciliationStatus,
  state: ReconciliationGraphState,
  next: readonly string[],
): string {
  if (state.terminal) return state.terminal;
  if (state.pendingReview) return `review_${state.pendingReview.kind}`;
  if (status === "queued") return "queued";
  if (status === "failed") return "failed";
  return next[0] ?? "processing";
}

function mapSummary(
  row: {
    id: string;
    submissionId: string;
    status: ReconciliationStatus;
    originalFilename: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  state: ReconciliationGraphState,
  next: readonly string[],
): ReconciliationSummary {
  return {
    id: row.id,
    submissionId: row.submissionId,
    status: row.status,
    stage: currentStage(row.status, state, next),
    originalFilename: row.originalFilename,
    invoiceNumber: state.extraction?.invoiceNumber ?? null,
    vendorName: state.extraction?.vendor.name ?? null,
    total: state.extraction?.total ?? null,
    currency: state.extraction?.currency ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
