import {
  ChannelType, Guild, ThreadAutoArchiveDuration, type TextChannel
} from "discord.js";
import { AttendanceStatus } from "@prisma/client";
import { prisma } from "../db.js";

export const ACTIVITY_THREAD_AUTO_ARCHIVE = ThreadAutoArchiveDuration.OneDay;

function threadName(name: string): string {
  return name.replace(/[\r\n]+/g, " ").trim().slice(0, 100) || "活動討論";
}

export async function createPrivateActivityThread(
  channel: TextChannel,
  name: string,
  memberIds: string[],
  openingMessage: string
) {
  const thread = await channel.threads.create({
    name: threadName(name),
    type: ChannelType.PrivateThread,
    invitable: false,
    autoArchiveDuration: ACTIVITY_THREAD_AUTO_ARCHIVE,
    reason: "建立活動私人討論串"
  });
  try {
    for (const userId of [...new Set(memberIds)]) await thread.members.add(userId);
    await thread.send(openingMessage);
    return thread;
  } catch (error) {
    await thread.delete("建立活動討論串失敗，回復操作").catch(() => undefined);
    throw error;
  }
}

export async function ensurePartyThread(guild: Guild, partyId: string): Promise<string> {
  const party = await prisma.party.findUnique({
    where: { id: partyId },
    include: { attendees: { where: { status: AttendanceStatus.GOING } } }
  });
  if (!party || party.guildId !== guild.id || !party.channelId) throw new Error("找不到派對或派對缺少來源頻道。");
  if (party.threadId) return party.threadId;
  const channel = await guild.channels.fetch(party.channelId);
  if (!channel || channel.type !== ChannelType.GuildText) throw new Error("派對貼文所在頻道無法建立私人討論串。");
  const thread = await createPrivateActivityThread(
    channel,
    `派對-${party.name}-${party.id.slice(-6)}`,
    [party.creatorId, ...party.attendees.map(attendee => attendee.userId)],
    `🎉 <@${party.creatorId}> 的派對私人討論串。\n詳細地點：**${party.privateLocation}**\n正式參加者會由 Bot 自動加入；請勿轉傳私人資訊。`
  );
  const claimed = await prisma.party.updateMany({ where: { id: party.id, threadId: null }, data: { threadId: thread.id } });
  if (claimed.count === 1) return thread.id;
  await thread.delete("已有其他活動討論串，清理重複項目").catch(() => undefined);
  const current = await prisma.party.findUnique({ where: { id: party.id }, select: { threadId: true } });
  if (!current?.threadId) throw new Error("無法建立派對私人討論串。");
  return current.threadId;
}

async function fetchThread(guild: Guild, threadId: string | null | undefined) {
  if (!threadId) return null;
  const channel = await guild.channels.fetch(threadId).catch(() => null);
  return channel?.isThread() ? channel : null;
}

export async function addActivityThreadMember(guild: Guild, threadId: string, userId: string): Promise<void> {
  const thread = await fetchThread(guild, threadId);
  if (!thread) throw new Error("找不到活動的私人討論串。");
  if (thread.archived && !thread.locked) await thread.setArchived(false, "新增正式參加者");
  await thread.members.add(userId);
}

export async function removeActivityThreadMember(guild: Guild, threadId: string, userId: string): Promise<void> {
  const thread = await fetchThread(guild, threadId);
  if (thread) await thread.members.remove(userId);
}

export async function closeActivityThread(guild: Guild, threadId: string | null | undefined): Promise<void> {
  const thread = await fetchThread(guild, threadId);
  if (!thread) return;
  if (thread.archived && !thread.locked) await thread.setArchived(false, "準備關閉活動討論串");
  if (!thread.locked) await thread.setLocked(true, "活動已結束或取消");
  if (!thread.archived) await thread.setArchived(true, "活動已結束或取消");
}
