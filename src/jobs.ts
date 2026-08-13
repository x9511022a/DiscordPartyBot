import { ActivityStatus } from "@prisma/client";
import type { Client } from "discord.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { closeActivityThread } from "./services/activity-threads.js";

export async function runMaintenance(client: Client): Promise<void> {
  const now = new Date();
  const activityCutoff = new Date(now.getTime() - config.ACTIVITY_RETENTION_DAYS * 86_400_000);
  const moderationCutoff = new Date(now.getTime() - config.MODERATION_RETENTION_DAYS * 86_400_000);
  const [endingDates, endingParties] = await Promise.all([
    prisma.datePost.findMany({ where: { scheduledAt: { lt: now }, status: { in: [ActivityStatus.OPEN, ActivityStatus.MATCHED] }, threadId: { not: null } }, select: { guildId: true, threadId: true } }),
    prisma.party.findMany({ where: { scheduledAt: { lt: now }, status: ActivityStatus.OPEN, threadId: { not: null } }, select: { guildId: true, threadId: true } })
  ]);
  for (const activity of [...endingDates, ...endingParties]) {
    const guild = await client.guilds.fetch(activity.guildId).catch(() => null);
    if (guild) await closeActivityThread(guild, activity.threadId).catch(error => console.error("自動封存活動討論串失敗", error));
  }
  await prisma.$transaction([
    prisma.datePost.updateMany({ where: { scheduledAt: { lt: now }, status: { in: [ActivityStatus.OPEN, ActivityStatus.MATCHED] } }, data: { status: ActivityStatus.ENDED, closedAt: now } }),
    prisma.party.updateMany({ where: { scheduledAt: { lt: now }, status: ActivityStatus.OPEN }, data: { status: ActivityStatus.ENDED, closedAt: now } }),
    prisma.interactionDraft.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.rateLimitEvent.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 2 * 86_400_000) } } }),
    prisma.datePost.deleteMany({ where: { closedAt: { lt: activityCutoff }, status: { in: [ActivityStatus.CANCELLED, ActivityStatus.CLOSED, ActivityStatus.ENDED, ActivityStatus.MATCHED] } } }),
    prisma.party.deleteMany({ where: { closedAt: { lt: activityCutoff }, status: { in: [ActivityStatus.CANCELLED, ActivityStatus.CLOSED, ActivityStatus.ENDED] } } }),
    prisma.moderationAction.deleteMany({ where: { createdAt: { lt: moderationCutoff }, reportId: null } }),
    prisma.report.deleteMany({ where: { createdAt: { lt: moderationCutoff }, status: { in: ["RESOLVED", "DISMISSED"] } } })
  ]);
  client.user && console.log(`[maintenance] ${now.toISOString()} 完成`);
}

export function startMaintenance(client: Client): NodeJS.Timeout {
  void runMaintenance(client).catch(error => console.error("維護工作失敗", error));
  return setInterval(() => void runMaintenance(client).catch(error => console.error("維護工作失敗", error)), config.JOB_INTERVAL_MINUTES * 60_000);
}
