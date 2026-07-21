import "dotenv/config";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { Client } from "langsmith";
import type { Example, ExampleCreate, ExampleUpdate } from "langsmith/schemas";

import {
  RECONCILIATION_EVAL_CASES,
  evalInputForCase,
  metadataForCase,
  referenceOutputForCase,
} from "./cases";
import {
  RECONCILIATION_EVAL_ATTACHMENT,
  RECONCILIATION_EVAL_DATASET,
} from "./schemas";

type DatasetClient = Pick<
  Client,
  | "hasDataset"
  | "createDataset"
  | "readDataset"
  | "listExamples"
  | "createExamples"
  | "updateExamples"
>;

async function loadExistingExamples(
  client: DatasetClient,
  datasetId: string,
): Promise<Example[]> {
  const examples: Example[] = [];
  for await (const example of client.listExamples({ datasetId })) examples.push(example);
  return examples;
}

export async function syncReconciliationEvalDataset(
  client: DatasetClient = new Client(),
): Promise<{ created: number; updated: number; datasetId: string }> {
  const hasDataset = await client.hasDataset({ datasetName: RECONCILIATION_EVAL_DATASET });
  const dataset = hasDataset
    ? await client.readDataset({ datasetName: RECONCILIATION_EVAL_DATASET })
    : await client.createDataset(RECONCILIATION_EVAL_DATASET, {
        description:
          "Synthetic invoice reconciliation cases evaluated through the first human review interrupt.",
        dataType: "kv",
        metadata: { managedBy: "focused-agent-reconciliation-evals" },
      });
  const existing = await loadExistingExamples(client, dataset.id);
  const managedByCase = new Map<string, Example>();
  for (const example of existing) {
    if (example.metadata?.managedBy !== "focused-agent-reconciliation-evals") continue;
    const caseId = example.metadata.caseId;
    if (typeof caseId !== "string") continue;
    if (managedByCase.has(caseId)) {
      throw new Error(`LangSmith dataset contains duplicate managed case ${caseId}.`);
    }
    managedByCase.set(caseId, example);
  }

  const creates: ExampleCreate[] = [];
  const updates: ExampleUpdate[] = [];
  for (const evalCase of RECONCILIATION_EVAL_CASES) {
    const pdfPath = path.join(process.cwd(), "samples", "pdf", "invoices", evalCase.sourcePdf);
    const bytes = await readFile(pdfPath);
    const common = {
      inputs: evalInputForCase(evalCase),
      outputs: referenceOutputForCase(evalCase),
      metadata: metadataForCase(evalCase),
      split: evalCase.split,
      attachments: {
        [RECONCILIATION_EVAL_ATTACHMENT]: {
          mimeType: "application/pdf",
          data: bytes,
        },
      },
    };
    const current = managedByCase.get(evalCase.id);
    if (current) updates.push({ id: current.id, dataset_id: dataset.id, ...common });
    else creates.push({ dataset_id: dataset.id, ...common });
  }
  if (creates.length > 0) await client.createExamples(creates);
  if (updates.length > 0) await client.updateExamples(updates);
  return { created: creates.length, updated: updates.length, datasetId: dataset.id };
}

async function main(): Promise<void> {
  const result = await syncReconciliationEvalDataset();
  console.log(
    `Synced ${RECONCILIATION_EVAL_DATASET}: ${result.created} created, ${result.updated} updated (${result.datasetId}).`,
  );
}

if (process.argv[1]?.endsWith("sync-dataset.ts")) {
  void main().catch((error: unknown) => {
    console.error("Could not sync reconciliation eval dataset.", error);
    process.exitCode = 1;
  });
}

