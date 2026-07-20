import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

import { invoiceReconciliationGraph } from "../src/server/agent/graph";

async function main(): Promise<void> {
  const [outputPath, ...extraArguments] = process.argv.slice(2);
  if (!outputPath || extraArguments.length > 0) {
    throw new Error("Usage: pnpm agent:graph -- <output.png>");
  }
  if (extname(outputPath).toLowerCase() !== ".png") {
    throw new Error("The graph output path must use a .png extension.");
  }

  const drawable = await invoiceReconciliationGraph.getGraphAsync({});
  const image = await drawable.drawMermaidPng({ backgroundColor: "white" });
  const resolvedOutputPath = resolve(outputPath);
  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, Buffer.from(await image.arrayBuffer()));
  console.log(`Rendered agent graph to ${resolvedOutputPath}`);
}

void main().catch((error: unknown) => {
  console.error("Could not render the agent graph.", error);
  process.exitCode = 1;
});
