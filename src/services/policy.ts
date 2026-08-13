import { ModerationActionType, type PrismaClient, type Prisma } from "@prisma/client";
import { assertConsent, assertModerationEligibility } from "../domain/rules.js";

type Db = PrismaClient | Prisma.TransactionClient;

export async function requireEligible(db: Db, guildId: string, userId: string): Promise<void> {
  const [consent, latestAction] = await Promise.all([
    db.userConsent.findUnique({ where: { guildId_userId: { guildId, userId } } }),
    db.moderationAction.findFirst({
      where: { guildId, targetUserId: userId, action: { in: [ModerationActionType.BAN, ModerationActionType.SUSPEND, ModerationActionType.UNBAN, ModerationActionType.UNSUSPEND] } },
      orderBy: { createdAt: "desc" }
    })
  ]);
  assertConsent(Boolean(consent));
  assertModerationEligibility(latestAction?.action ?? null, latestAction?.expiresAt ?? null);
}

export async function isBlockedEitherWay(db: Db, guildId: string, a: string, b: string): Promise<boolean> {
  const count = await db.userBlock.count({
    where: { guildId, OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] }
  });
  return count > 0;
}
