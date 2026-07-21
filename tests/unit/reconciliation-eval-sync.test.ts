import { describe, expect, it, vi } from "vitest";

import { RECONCILIATION_EVAL_CASES } from "../../evals/reconciliation/cases";
import { syncReconciliationEvalDataset } from "../../evals/reconciliation/sync-dataset";

type SyncClient = NonNullable<Parameters<typeof syncReconciliationEvalDataset>[0]>;

function clientWithExamples(examples: unknown[] = []) {
  const createExamples = vi.fn().mockResolvedValue([]);
  const updateExamples = vi.fn().mockResolvedValue([]);
  const client = {
    hasDataset: vi.fn().mockResolvedValue(true),
    readDataset: vi.fn().mockResolvedValue({ id: "dataset-id" }),
    createDataset: vi.fn(),
    async *listExamples() {
      for (const example of examples) yield example;
    },
    createExamples,
    updateExamples,
  } as unknown as SyncClient;
  return { client, createExamples, updateExamples };
}

describe("reconciliation eval dataset sync", () => {
  it("creates every missing managed example with its PDF attachment", async () => {
    const { client, createExamples, updateExamples } = clientWithExamples();
    const result = await syncReconciliationEvalDataset(client);
    expect(result).toEqual({ created: 13, updated: 0, datasetId: "dataset-id" });
    expect(updateExamples).not.toHaveBeenCalled();
    const uploads = createExamples.mock.calls[0]?.[0] as Array<{
      metadata: { caseId: string };
      attachments: Record<string, { mimeType: string; data: Uint8Array }>;
    }>;
    expect(uploads).toHaveLength(13);
    expect(uploads[0]?.metadata.caseId).toBe("acme-po-1001-exact");
    expect(uploads[0]?.attachments.invoice.mimeType).toBe("application/pdf");
    expect(uploads[0]?.attachments.invoice.data.byteLength).toBeGreaterThan(0);
  });

  it("updates managed examples by case ID without creating duplicates", async () => {
    const examples = RECONCILIATION_EVAL_CASES.map((evalCase, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      metadata: {
        managedBy: "focused-agent-reconciliation-evals",
        caseId: evalCase.id,
      },
    }));
    const { client, createExamples, updateExamples } = clientWithExamples(examples);
    const result = await syncReconciliationEvalDataset(client);
    expect(result).toEqual({ created: 0, updated: 13, datasetId: "dataset-id" });
    expect(createExamples).not.toHaveBeenCalled();
    expect(updateExamples).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: examples[0]?.id, dataset_id: "dataset-id" }),
      ]),
    );
  });

  it("rejects duplicate managed case IDs already in LangSmith", async () => {
    const duplicate = {
      id: "00000000-0000-4000-8000-000000000001",
      metadata: {
        managedBy: "focused-agent-reconciliation-evals",
        caseId: "acme-po-1001-exact",
      },
    };
    const { client } = clientWithExamples([
      duplicate,
      { ...duplicate, id: "00000000-0000-4000-8000-000000000002" },
    ]);
    await expect(syncReconciliationEvalDataset(client)).rejects.toThrow(
      "duplicate managed case",
    );
  });
});

