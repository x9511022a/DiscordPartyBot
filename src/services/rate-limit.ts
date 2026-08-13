import type { PrismaClient } from "@prisma/client";
import { config } from "../config.js";

const limits: Record<string, number> = {
  DATE_CREATE: config.DATE_POST_DAILY_LIMIT,
  PARTY_CREATE: config.PARTY_POST_DAILY_LIMIT,
  DATE_APPLY: config.APPLICATION_DAILY_LIMIT
};

export async function consumeRateLimit(db: PrismaClient, guildId: string, userId: string, action: keyof typeof limits): Promise<void> {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const cooldown = new Date(now.getTime() - config.ACTION_COOLDOWN_SECONDS * 1000);
  const [daily, latest] = await Promise.all([
    db.rateLimitEvent.count({ where: { guildId, userId, action, createdAt: { gte: dayAgo } } }),
    db.rateLimitEvent.findFirst({ where: { guildId, userId, action, createdAt: { gte: cooldown } } })
  ]);
  if (latest) throw new Error(`操作太快，請等待 ${config.ACTION_COOLDOWN_SECONDS} 秒後再試。`);
  if (daily >= limits[action]!) throw new Error("你今天的此類操作已達上限，請明天再試。");
  await db.rateLimitEvent.create({ data: { guildId, userId, action } });
}
