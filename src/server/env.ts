import { z } from "zod";

const ServerEnvSchema = z.object({
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

let cachedEnv: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cachedEnv ??= ServerEnvSchema.parse(process.env);
  return cachedEnv;
}

export function resetServerEnvForTests(): void {
  cachedEnv = undefined;
}
