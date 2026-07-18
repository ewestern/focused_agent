import { Pool } from "pg";

import { getServerEnv } from "@/server/env";

declare global {
  var focusedAgentPool: Pool | undefined;
  var focusedAgentPoolSignalsRegistered: boolean | undefined;
}

export function getPool(): Pool {
  if (!globalThis.focusedAgentPool) {
    globalThis.focusedAgentPool = new Pool({
      connectionString: getServerEnv().DATABASE_URL,
      max: 10,
    });
  }

  if (!globalThis.focusedAgentPoolSignalsRegistered) {
    globalThis.focusedAgentPoolSignalsRegistered = true;
    const close = () => {
      void globalThis.focusedAgentPool?.end();
      globalThis.focusedAgentPool = undefined;
    };
    process.once("SIGTERM", close);
    process.once("SIGINT", close);
  }

  return globalThis.focusedAgentPool;
}
