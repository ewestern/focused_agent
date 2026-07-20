import { z } from "zod";

const ServerEnvSchema = z.object({
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  S3_ENDPOINT: z.string().url().default("http://localhost:9000"),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_BUCKET: z.string().min(3).default("invoice-documents"),
  S3_ACCESS_KEY_ID: z.string().min(1).default("focused_agent"),
  S3_SECRET_ACCESS_KEY: z.string().min(8).default("focused_agent_secret"),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  SMTP_HOST: z.string().min(1).default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_FROM: z.string().email().default("reconciliation@example.test"),
  OPENAI_API_KEY: z.string().default(""),
  AGENT_MODEL: z.string().min(1).default("gpt-5.6-luna"),
  SEED_DEMO_DATA: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
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
