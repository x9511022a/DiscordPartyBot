import { ActivityStatus, ApplicationStatus, AttendanceStatus } from "@prisma/client";
import {
  ActionRowBuilder, ButtonInteraction, ChannelType as DiscordChannelType, GuildMember, ModalBuilder,
  TextInputBuilder, TextInputStyle
} from "discord.js";
import { prisma } from "../db.js";
import { joinParty, leaveParty, partyCounts } from "../services/party.js";
import { requireEligible } from "../services/policy.js";
import { parseCustomId } from "../utils/custom-id.js";
import { safeDm } from "../utils/discord.js";
import { dateMessage, partyMessage } from "../views.js";

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
  await interaction.deferReply({ ephemeral: true });
  let threadId: string | null = null;
  try {
    const guild = await interaction.client.guilds.fetch(post.guildId);
    const cfg = await prisma.guildConfig.findUniqueOrThrow({ where: { guildId: post.guildId } });
    const channel = await guild.channels.fetch(cfg.matchHubChannelId);
    if (!channel || channel.type !== DiscordChannelType.GuildText) throw new Error("私人媒合區設定無效。");
    await Promise.all([
      channel.permissionOverwrites.edit(post.creatorId, { ViewChannel: true, SendMessages: false, SendMessagesInThreads: true }),
      channel.permissionOverwrites.edit(application.applicantId, { ViewChannel: true, SendMessages: false, SendMessagesInThreads: true })
    ]);
    const thread = await channel.threads.create({ name: `約會媒合-${post.id.slice(-6)}`, type: DiscordChannelType.PrivateThread, invitable: false, reason: "約會申請已接受" });
    threadId = thread.id;
    await Promise.all([thread.members.add(post.creatorId), thread.members.add(application.applicantId)]);
    await thread.send(`💗 <@${post.creatorId}> 與 <@${application.applicantId}> 已完成媒合。\n詳細地點：**${post.privateLocation}**\n請勿轉傳私人資訊；如有問題請使用 /report。`);
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
  await interaction.reply({ content: "已拒絕申請。", ephemeral: true });
}

export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const parsed = parseCustomId(interaction.customId); if (!parsed) return;
  if (parsed.action === "date_accept") return acceptDate(interaction, parsed.id);
  if (parsed.action === "date_decline") return declineDate(interaction, parsed.id);
  if (!interaction.inCachedGuild()) throw new Error("此操作必須在伺服器內完成。");
  await requireEligible(prisma, interaction.guildId, interaction.user.id);

  if (parsed.action === "date_apply") {
    const modal = new ModalBuilder().setCustomId(`date_application:${parsed.id}`).setTitle("申請約會").addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("intro").setLabel("給發起者的簡短自介").setStyle(TextInputStyle.Paragraph).setMinLength(10).setMaxLength(1000).setRequired(true))
    );
    await interaction.showModal(modal); return;
  }
  if (parsed.action === "party_join") {
    const party = await prisma.party.findUnique({ where: { id: parsed.id } });
    if (!party || party.guildId !== interaction.guildId) throw new Error("找不到 Party。");
    const member = interaction.member as GuildMember;
    if (party.visibilityRoleId && !member.roles.cache.has(party.visibilityRoleId)) throw new Error("你沒有此 Party 所需的 Role。");
    const result = await joinParty(interaction.guildId, parsed.id, interaction.user.id);
    await interaction.reply({ content: result.status === AttendanceStatus.GOING ? `報名成功！詳細地點：**${result.privateLocation}**` : "目前已額滿，你已加入候補。", ephemeral: true });
    await refreshParty(interaction, parsed.id); return;
  }
  if (parsed.action === "party_leave") {
    const result = await leaveParty(interaction.guildId, parsed.id, interaction.user.id);
    await interaction.reply({ content: "已退出此 Party。", ephemeral: true });
    if (result.promotedUserId) await safeDm(interaction.guild, result.promotedUserId, `Party 候補已遞補成功！詳細地點：**${result.privateLocation}**`);
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
    for (const app of post.applications) await safeDm(interaction.guild, app.applicantId, `約會「${post.activity}」已取消。`);
    return;
  }
  if (parsed.action === "party_cancel") {
    const party = await prisma.party.findFirst({ where: { id: parsed.id, guildId: interaction.guildId, creatorId: interaction.user.id, status: ActivityStatus.OPEN }, include: { attendees: true } });
    if (!party) throw new Error("只有發起者可以取消有效的 Party。");
    await prisma.$transaction([
      prisma.party.update({ where: { id: party.id }, data: { status: ActivityStatus.CANCELLED, closedAt: new Date() } }),
      prisma.partyAttendance.updateMany({ where: { partyId: party.id, status: { in: [AttendanceStatus.GOING, AttendanceStatus.WAITLISTED] } }, data: { status: AttendanceStatus.CANCELLED, queueNumber: null } })
    ]);
    const updated = await prisma.party.findUniqueOrThrow({ where: { id: party.id } });
    await interaction.update(partyMessage(updated, 0, 0, true));
    for (const x of party.attendees) await safeDm(interaction.guild, x.userId, `Party「${party.name}」已取消。`);
  }
}
