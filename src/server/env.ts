import { z } from "zod";

const ServerEnvSchema = z.object({
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(8),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .transform((value) => value === "true"),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_FROM: z.string().email(),
  OPENAI_API_KEY: z.string(),
  AGENT_MODEL: z.string().min(1),
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
