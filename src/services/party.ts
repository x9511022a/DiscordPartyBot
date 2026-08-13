import { AttendanceStatus } from "@prisma/client";
import { serializable } from "./transaction.js";
import { isBlockedEitherWay } from "./policy.js";
import { nextPartyStatus } from "../domain/rules.js";

export async function joinParty(guildId: string, partyId: string, userId: string): Promise<{ status: AttendanceStatus; privateLocation?: string }> {
  return serializable(async tx => {
    const party = await tx.party.findUnique({ where: { id: partyId } });
    if (!party || party.guildId !== guildId) throw new Error("找不到 Party。");
    if (party.creatorId === userId) throw new Error("發起者不需要報名自己的 Party。");
    if (party.status !== "OPEN" || party.signupDeadline <= new Date()) throw new Error("此 Party 已停止報名。");
    if (await isBlockedEitherWay(tx, guildId, party.creatorId, userId)) throw new Error("你無法參加此活動。");

    const existing = await tx.partyAttendance.findUnique({ where: { partyId_userId: { partyId, userId } } });
    if (existing && (existing.status === AttendanceStatus.GOING || existing.status === AttendanceStatus.WAITLISTED)) throw new Error("你已經報名此 Party。");
    const going = await tx.partyAttendance.count({ where: { partyId, status: AttendanceStatus.GOING } });
    const status = nextPartyStatus(going, party.capacity);
    const lastWaiting = status === AttendanceStatus.WAITLISTED
      ? await tx.partyAttendance.findFirst({ where: { partyId, status: AttendanceStatus.WAITLISTED }, orderBy: { queueNumber: "desc" } })
      : null;
    await tx.partyAttendance.upsert({
      where: { partyId_userId: { partyId, userId } },
      create: { partyId, userId, status, queueNumber: status === AttendanceStatus.WAITLISTED ? (lastWaiting?.queueNumber ?? 0) + 1 : null },
      update: { status, queueNumber: status === AttendanceStatus.WAITLISTED ? (lastWaiting?.queueNumber ?? 0) + 1 : null }
    });
    return { status, privateLocation: status === AttendanceStatus.GOING ? party.privateLocation : undefined };
  });
}

export async function leaveParty(guildId: string, partyId: string, userId: string): Promise<{ promotedUserId?: string; privateLocation?: string }> {
  return serializable(async tx => {
    const party = await tx.party.findUnique({ where: { id: partyId } });
    if (!party || party.guildId !== guildId) throw new Error("找不到 Party。");
    const attendance = await tx.partyAttendance.findUnique({ where: { partyId_userId: { partyId, userId } } });
    if (!attendance || (attendance.status !== AttendanceStatus.GOING && attendance.status !== AttendanceStatus.WAITLISTED)) throw new Error("你目前沒有報名此 Party。");
    await tx.partyAttendance.update({ where: { id: attendance.id }, data: { status: AttendanceStatus.LEFT, queueNumber: null } });
    if (attendance.status === AttendanceStatus.WAITLISTED) return {};
    const next = await tx.partyAttendance.findFirst({ where: { partyId, status: AttendanceStatus.WAITLISTED }, orderBy: [{ queueNumber: "asc" }, { createdAt: "asc" }] });
    if (!next) return {};
    await tx.partyAttendance.update({ where: { id: next.id }, data: { status: AttendanceStatus.GOING, queueNumber: null } });
    return { promotedUserId: next.userId, privateLocation: party.privateLocation };
  });
}

export async function partyCounts(partyId: string): Promise<{ going: number; waiting: number }> {
  const { prisma } = await import("../db.js");
  const [going, waiting] = await Promise.all([
    prisma.partyAttendance.count({ where: { partyId, status: AttendanceStatus.GOING } }),
    prisma.partyAttendance.count({ where: { partyId, status: AttendanceStatus.WAITLISTED } })
  ]);
  return { going, waiting };
}
