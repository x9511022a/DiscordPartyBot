import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().optional(),
  DATABASE_URL: z.string().min(1),
  DATE_POST_DAILY_LIMIT: z.coerce.number().int().positive().default(3),
  PARTY_POST_DAILY_LIMIT: z.coerce.number().int().positive().default(5),
  APPLICATION_DAILY_LIMIT: z.coerce.number().int().positive().default(20),
  ACTION_COOLDOWN_SECONDS: z.coerce.number().int().nonnegative().default(10),
  ACTIVITY_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  MODERATION_RETENTION_DAYS: z.coerce.number().int().positive().default(180),
  JOB_INTERVAL_MINUTES: z.coerce.number().int().positive().default(60)
});

export const config = envSchema.parse(process.env);
