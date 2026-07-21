import "dotenv/config";

import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

import { Client } from "langsmith";
import { evaluate } from "langsmith/evaluation";

import { DEFAULT_RECONCILIATION_POLICY } from "@/server/reconciliation/policy";
import { reconciliationEvaluator } from "./evaluators";
import {
  RECONCILIATION_EVAL_CORPUS_VERSION,
  RECONCILIATION_EVAL_DATASET,
} from "./schemas";
import { createReconciliationEvalTarget } from "./target";

export type ExperimentOptions = {
  split?: "smoke" | "regression";
  repetitions: number;
  concurrency: number;
};

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

export function parseExperimentOptions(args: string[]): ExperimentOptions {
  const parsed = parseArgs({
    args,
    options: {
      split: { type: "string" },
      repetitions: { type: "string" },
      concurrency: { type: "string" },
    },
    strict: true,
  });
  if (parsed.values.split && !["smoke", "regression"].includes(parsed.values.split)) {
    throw new Error("split must be smoke or regression.");
  }
  return {
    split: parsed.values.split as ExperimentOptions["split"],
    repetitions: positiveInteger(parsed.values.repetitions, 3, "repetitions"),
    concurrency: positiveInteger(parsed.values.concurrency, 1, "concurrency"),
  };
}

function gitValue(args: string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export async function runReconciliationExperiment(options: ExperimentOptions) {
  const model = process.env.AGENT_MODEL?.trim();
  if (!model) throw new Error("AGENT_MODEL is required to run reconciliation evals.");
  const client = new Client();
  const data = options.split
    ? client.listExamples({
        datasetName: RECONCILIATION_EVAL_DATASET,
        splits: [options.split],
        includeAttachments: true,
      })
    : RECONCILIATION_EVAL_DATASET;
  return evaluate(createReconciliationEvalTarget(), {
    data,
    client,
    evaluators: [reconciliationEvaluator],
    includeAttachments: true,
    numRepetitions: options.repetitions,
    maxConcurrency: options.concurrency,
    experimentPrefix: `${model}-${DEFAULT_RECONCILIATION_POLICY.version}`,
    metadata: {
      models: model,
      policyVersion: DEFAULT_RECONCILIATION_POLICY.version,
      corpusVersion: RECONCILIATION_EVAL_CORPUS_VERSION,
      split: options.split ?? "all",
      gitCommit: gitValue(["rev-parse", "HEAD"]),
      gitDirty: gitValue(["status", "--porcelain"]) ? "true" : "false",
    },
  });
}

async function main(): Promise<void> {
  await runReconciliationExperiment(parseExperimentOptions(process.argv.slice(2)));
}

if (process.argv[1]?.endsWith("run-experiment.ts")) {
  void main().catch((error: unknown) => {
    console.error("Reconciliation eval experiment failed.", error);
    process.exitCode = 1;
  });
}

