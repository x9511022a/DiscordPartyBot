import { ActivityStatus, ApplicationStatus, AttendanceStatus } from "@prisma/client";
import {
  ActionRowBuilder, ButtonInteraction, ChannelType, MessageFlags, ModalBuilder,
  TextInputBuilder, TextInputStyle
} from "discord.js";
import { prisma } from "../db.js";
import { joinParty, leaveParty, partyCounts, undoPartyJoin } from "../services/party.js";
import { requireEligible } from "../services/policy.js";
import { parseCustomId } from "../utils/custom-id.js";
import { resolveGuild, safeDm } from "../utils/discord.js";
import { dateMessage, partyMessage } from "../views.js";
import { addActivityThreadMember, closeActivityThread, createPrivateActivityThread, ensurePartyThread, removeActivityThreadMember } from "../services/activity-threads.js";
import { handlePanelButton, showManagedActivityFromPost } from "./panel.js";

async function refreshParty(interaction: ButtonInteraction, partyId: string, disabled = false) {
  const party = await prisma.party.findUnique({ where: { id: partyId } });
  if (!party) return;
  const counts = await partyCounts(partyId);
  if (interaction.message.editable) await interaction.message.edit(partyMessage(party, counts.going, counts.waiting, disabled)).catch(() => undefined);
}

async function acceptDate(interaction: ButtonInteraction, applicationId: string) {
  const application = await prisma.dateApplication.findUnique({ where: { id: applicationId }, include: { datePost: true } });
  if (!application) throw new Error("找不到此申請。");
  const post = application.datePost;
  if (interaction.user.id !== post.creatorId) throw new Error("只有發起者可以處理申請。");
  const reserved = await prisma.$transaction(async tx => {
    const locked = await tx.datePost.updateMany({ where: { id: post.id, status: ActivityStatus.OPEN }, data: { status: ActivityStatus.MATCHING, matchingAppId: application.id } });
    if (locked.count !== 1) return false;
    const app = await tx.dateApplication.updateMany({ where: { id: application.id, status: ApplicationStatus.PENDING }, data: { status: ApplicationStatus.MATCHING } });
    if (app.count !== 1) throw new Error("此申請已被處理。");
    return true;
  });
  if (!reserved) throw new Error("此約會已完成媒合或正在處理其他申請。");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let threadId: string | null = null;
  try {
    const guild = await interaction.client.guilds.fetch(post.guildId);
    if (!post.channelId) throw new Error("約會貼文缺少來源頻道，無法建立私人討論串。");
    const channel = await guild.channels.fetch(post.channelId);
    if (!channel || channel.type !== ChannelType.GuildText) throw new Error("約會貼文所在頻道無法建立私人討論串。");
    const thread = await createPrivateActivityThread(
      channel,
      `約會媒合-${post.activity}-${post.id.slice(-6)}`,
      [post.creatorId, application.applicantId],
      `💗 <@${post.creatorId}> 與 <@${application.applicantId}> 已完成媒合。\n詳細地點：**${post.privateLocation}**\n請勿轉傳私人資訊；如有問題請從私人選單進入安全中心檢舉。`
    );
    threadId = thread.id;
    await prisma.$transaction([
      prisma.datePost.update({ where: { id: post.id }, data: { status: ActivityStatus.MATCHED, matchedUserId: application.applicantId, threadId, matchingAppId: null, closedAt: new Date() } }),
      prisma.dateApplication.update({ where: { id: application.id }, data: { status: ApplicationStatus.ACCEPTED } }),
      prisma.dateApplication.updateMany({ where: { datePostId: post.id, id: { not: application.id }, status: ApplicationStatus.PENDING }, data: { status: ApplicationStatus.DECLINED } })
    ]);
    if (post.channelId && post.messageId) {
      const publicChannel = await guild.channels.fetch(post.channelId).catch(() => null);
      const updated = await prisma.datePost.findUniqueOrThrow({ where: { id: post.id } });
      if (publicChannel?.isTextBased()) await publicChannel.messages.fetch(post.messageId).then(m => m.edit(dateMessage(updated, true))).catch(() => undefined);
    }
    await interaction.editReply(`已接受申請並建立私人討論串：<#${threadId}>。`);
    await safeDm(guild, application.applicantId, `你的約會申請已被接受：<#${threadId}>。`);
  } catch (error) {
    await prisma.$transaction([
      prisma.datePost.updateMany({ where: { id: post.id, status: ActivityStatus.MATCHING, matchingAppId: application.id }, data: { status: ActivityStatus.OPEN, matchingAppId: null } }),
      prisma.dateApplication.updateMany({ where: { id: application.id, status: ApplicationStatus.MATCHING }, data: { status: ApplicationStatus.PENDING } })
    ]);
    if (threadId) {
      const guild = await interaction.client.guilds.fetch(post.guildId).catch(() => null);
      const thread = guild ? await guild.channels.fetch(threadId).catch(() => null) : null;
      if (thread?.isThread()) await thread.delete("媒合交易失敗，清理討論串").catch(() => undefined);
    }
    throw error;
  }
}

async function declineDate(interaction: ButtonInteraction, applicationId: string) {
  const app = await prisma.dateApplication.findUnique({ where: { id: applicationId }, include: { datePost: true } });
  if (!app || app.datePost.creatorId !== interaction.user.id) throw new Error("找不到申請或你不是發起者。");
  const updated = await prisma.dateApplication.updateMany({ where: { id: applicationId, status: ApplicationStatus.PENDING }, data: { status: ApplicationStatus.DECLINED } });
  if (!updated.count) throw new Error("此申請已被處理。");
  const guild = await interaction.client.guilds.fetch(app.datePost.guildId);
  await safeDm(guild, app.applicantId, `你對約會「${app.datePost.activity}」的申請未被接受。`);
  await interaction.reply({ content: "已拒絕申請。", flags: MessageFlags.Ephemeral });
}

export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  if (await handlePanelButton(interaction)) return;
  const parsed = parseCustomId(interaction.customId); if (!parsed) return;
  if (parsed.action === "date_manage") return showManagedActivityFromPost(interaction, "約會", parsed.id);
  if (parsed.action === "party_manage") return showManagedActivityFromPost(interaction, "派對", parsed.id);
  if (parsed.action === "date_accept") return acceptDate(interaction, parsed.id);
  if (parsed.action === "date_decline") return declineDate(interaction, parsed.id);
  if (!interaction.guildId) throw new Error("此操作必須在伺服器內完成。");
  const guild = await resolveGuild(interaction);
  await requireEligible(prisma, interaction.guildId, interaction.user.id);

  if (parsed.action === "date_apply") {
    const modal = new ModalBuilder().setCustomId(`date_application:${parsed.id}`).setTitle("申請約會").addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("intro").setLabel("給發起者的簡短自介").setStyle(TextInputStyle.Paragraph).setMinLength(10).setMaxLength(1000).setRequired(true))
    );
    await interaction.showModal(modal); return;
  }
  if (parsed.action === "party_join") {
    const party = await prisma.party.findUnique({ where: { id: parsed.id } });
    if (!party || party.guildId !== interaction.guildId) throw new Error("找不到派對。");
    const member = await guild.members.fetch(interaction.user.id);
    if (party.visibilityRoleId && !member.roles.cache.has(party.visibilityRoleId)) throw new Error("你沒有此派對所需的身分組。");
    const result = await joinParty(interaction.guildId, parsed.id, interaction.user.id);
    let partyThreadId = result.threadId;
    if (result.status === AttendanceStatus.GOING) {
      try {
        partyThreadId ??= await ensurePartyThread(guild, parsed.id);
        await addActivityThreadMember(guild, partyThreadId, interaction.user.id);
      }
      catch (error) {
        await undoPartyJoin(parsed.id, interaction.user.id);
        if (partyThreadId) await removeActivityThreadMember(guild, partyThreadId, interaction.user.id).catch(() => undefined);
        throw error;
      }
    }
    await interaction.reply({ content: result.status === AttendanceStatus.GOING ? `報名成功！已將你加入私人討論串：<#${partyThreadId}>。` : "目前已額滿，你已加入候補。", flags: MessageFlags.Ephemeral });
    await refreshParty(interaction, parsed.id); return;
  }
  if (parsed.action === "party_leave") {
    const result = await leaveParty(interaction.guildId, parsed.id, interaction.user.id);
    if (result.threadId) await removeActivityThreadMember(guild, result.threadId, interaction.user.id).catch(error => console.error("移除派對討論串成員失敗", error));
    await interaction.reply({ content: "已退出此派對。", flags: MessageFlags.Ephemeral });
    if (result.promotedUserId) {
      const threadId = result.threadId ?? await ensurePartyThread(guild, parsed.id).catch(() => undefined);
      let added = false;
      if (threadId) added = await addActivityThreadMember(guild, threadId, result.promotedUserId).then(() => true).catch(error => { console.error("加入遞補者至派對討論串失敗", error); return false; });
      await safeDm(guild, result.promotedUserId, added ? `派對候補已遞補成功！私人討論串：<#${threadId}>。` : `派對候補已遞補成功！詳細地點：**${result.privateLocation}**`);
    }
    await refreshParty(interaction, parsed.id); return;
  }
  if (parsed.action === "date_cancel") {
    const post = await prisma.datePost.findFirst({ where: { id: parsed.id, guildId: interaction.guildId, creatorId: interaction.user.id, status: { in: [ActivityStatus.OPEN, ActivityStatus.MATCHED] } }, include: { applications: true } });
    if (!post) throw new Error("只有發起者可以取消有效的約會。");
    await prisma.$transaction([
      prisma.datePost.update({ where: { id: post.id }, data: { status: ActivityStatus.CANCELLED, closedAt: new Date(), matchingAppId: null } }),
      prisma.dateApplication.updateMany({ where: { datePostId: post.id, status: { in: [ApplicationStatus.PENDING, ApplicationStatus.ACCEPTED] } }, data: { status: ApplicationStatus.CANCELLED } })
    ]);
    const updated = await prisma.datePost.findUniqueOrThrow({ where: { id: post.id } });
    await interaction.update(dateMessage(updated, true));
    for (const app of post.applications) await safeDm(guild, app.applicantId, `約會「${post.activity}」已取消。`);
    await closeActivityThread(guild, post.threadId).catch(error => console.error("關閉約會討論串失敗", error));
    return;
  }
  if (parsed.action === "party_cancel") {
    const party = await prisma.party.findFirst({ where: { id: parsed.id, guildId: interaction.guildId, creatorId: interaction.user.id, status: ActivityStatus.OPEN }, include: { attendees: true } });
    if (!party) throw new Error("只有發起者可以取消有效的派對。");
    await prisma.$transaction([
      prisma.party.update({ where: { id: party.id }, data: { status: ActivityStatus.CANCELLED, closedAt: new Date() } }),
      prisma.partyAttendance.updateMany({ where: { partyId: party.id, status: { in: [AttendanceStatus.GOING, AttendanceStatus.WAITLISTED] } }, data: { status: AttendanceStatus.CANCELLED, queueNumber: null } })
    ]);
    const updated = await prisma.party.findUniqueOrThrow({ where: { id: party.id } });
    await interaction.update(partyMessage(updated, 0, 0, true));
    for (const x of party.attendees) await safeDm(guild, x.userId, `派對「${party.name}」已取消。`);
    await closeActivityThread(guild, party.threadId).catch(error => console.error("關閉派對討論串失敗", error));
  }
}
