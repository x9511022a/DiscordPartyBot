import { ActivityStatus, ModerationActionType, Prisma } from "@prisma/client";
import {
  ActionRowBuilder, ChannelType, ChatInputCommandInteraction, EmbedBuilder, GuildMember,
  ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle
} from "discord.js";
import { prisma } from "../db.js";
import { requireEligible } from "../services/policy.js";
import { consumeRateLimit } from "../services/rate-limit.js";
import { assertPrivateHub, resolveGuild } from "../utils/discord.js";
import { parseDateTime } from "../utils/time.js";

function row(input: TextInputBuilder) { return new ActionRowBuilder<TextInputBuilder>().addComponents(input); }
function textInput(id: string, label: string, style = TextInputStyle.Short, required = true, max = 1000, value?: string) {
  const input = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(max);
  if (value) input.setValue(value.slice(0, max));
  return row(input);
}

async function makeDraft(interaction: ChatInputCommandInteraction, kind: string, payload: Prisma.InputJsonValue) {
  return prisma.interactionDraft.create({ data: { guildId: interaction.guildId!, userId: interaction.user.id, kind, payload, expiresAt: new Date(Date.now() + 15 * 60_000) } });
}

async function setup(interaction: ChatInputCommandInteraction) {
  const guild = await resolveGuild(interaction);
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new Error("需要管理伺服器權限。");
  const sub = interaction.options.getSubcommand();
  if (sub === "channels") {
    const date = interaction.options.getChannel("date", true);
    const party = interaction.options.getChannel("party", true);
    const hub = interaction.options.getChannel("match_hub", true);
    const moderation = interaction.options.getChannel("moderation", true);
    await assertPrivateHub(guild, hub.id);
    await prisma.guildConfig.upsert({
      where: { guildId: interaction.guildId! },
      create: { guildId: interaction.guildId!, dateChannelId: date.id, publicPartyChannelId: party.id, matchHubChannelId: hub.id, moderationChannelId: moderation.id },
      update: { dateChannelId: date.id, publicPartyChannelId: party.id, matchHubChannelId: hub.id, moderationChannelId: moderation.id }
    });
    await interaction.reply({ content: "主要頻道設定完成。", ephemeral: true });
    return;
  }
  const config = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guildId! }, include: { rolePartyChannels: true } });
  if (!config) throw new Error("請先執行 /setup channels。");
  if (sub === "role_channel") {
    const role = interaction.options.getRole("role", true);
    const selected = interaction.options.getChannel("channel", true);
    const channel = await guild.channels.fetch(selected.id);
    if (!channel || channel.type !== ChannelType.GuildText) throw new Error("必須選擇文字頻道。");
    const everyoneCanView = channel.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel);
    const roleCanView = channel.permissionsFor(role.id)?.has(PermissionFlagsBits.ViewChannel);
    if (everyoneCanView || !roleCanView) throw new Error("此頻道必須禁止 @everyone 查看，並允許指定 Role 查看。");
    await prisma.rolePartyChannel.upsert({
      where: { guildId_roleId: { guildId: interaction.guildId!, roleId: role.id } },
      create: { guildId: interaction.guildId!, roleId: role.id, channelId: channel.id }, update: { channelId: channel.id }
    });
    await interaction.reply({ content: `已將 <@&${role.id}> 對應至 <#${channel.id}>。`, ephemeral: true });
    return;
  }
  const roles = config.rolePartyChannels.map(x => `<@&${x.roleId}> → <#${x.channelId}>`).join("\n") || "尚未設定";
  await interaction.reply({ content: `約會：<#${config.dateChannelId}>\n公開 Party：<#${config.publicPartyChannelId}>\n私人媒合：<#${config.matchHubChannelId}>\n管理紀錄：<#${config.moderationChannelId}>\nRole 頻道：\n${roles}`, ephemeral: true });
}

async function createDateModal(interaction: ChatInputCommandInteraction, editing = false) {
  await requireEligible(prisma, interaction.guildId!, interaction.user.id);
  const id = editing ? interaction.options.getString("id", true) : null;
  const existing = id ? await prisma.datePost.findFirst({ where: { id, guildId: interaction.guildId!, creatorId: interaction.user.id, status: ActivityStatus.OPEN } }) : null;
  if (editing && !existing) throw new Error("找不到可編輯的約會，或你不是發起者。");
  if (!editing) await consumeRateLimit(prisma, interaction.guildId!, interaction.user.id, "DATE_CREATE");
  const time = interaction.options.getString("time") ?? existing?.scheduledAt.toISOString();
  const area = interaction.options.getString("area") ?? existing?.publicArea;
  const scheduledAt = parseDateTime(time!);
  const draft = await makeDraft(interaction, editing ? "DATE_EDIT" : "DATE_CREATE", { id, scheduledAt: scheduledAt.toISOString(), area });
  const modal = new ModalBuilder().setCustomId(`date_form:${draft.id}`).setTitle(editing ? "編輯約會" : "建立約會").addComponents(
    textInput("activity", "活動內容", TextInputStyle.Short, true, 100, existing?.activity),
    textInput("private_location", "詳細地點（不公開）", TextInputStyle.Short, true, 200, existing?.privateLocation),
    textInput("cost", "費用方式", TextInputStyle.Short, true, 100, existing?.cost),
    textInput("desired_person", "希望對象", TextInputStyle.Paragraph, true, 500, existing?.desiredPerson),
    textInput("notes", "注意事項（選填）", TextInputStyle.Paragraph, false, 1000, existing?.notes ?? undefined)
  );
  await interaction.showModal(modal);
}

async function createPartyModal(interaction: ChatInputCommandInteraction, editing = false) {
  await requireEligible(prisma, interaction.guildId!, interaction.user.id);
  const id = editing ? interaction.options.getString("id", true) : null;
  const existing = id ? await prisma.party.findFirst({ where: { id, guildId: interaction.guildId!, creatorId: interaction.user.id, status: ActivityStatus.OPEN } }) : null;
  if (editing && !existing) throw new Error("找不到可編輯的 Party，或你不是發起者。");
  if (!editing) await consumeRateLimit(prisma, interaction.guildId!, interaction.user.id, "PARTY_CREATE");
  const name = editing ? existing!.name : interaction.options.getString("name", true);
  const time = interaction.options.getString("time") ?? existing?.scheduledAt.toISOString();
  const deadline = interaction.options.getString("deadline") ?? existing?.signupDeadline.toISOString();
  const capacity = interaction.options.getInteger("capacity") ?? existing?.capacity;
  const roleId = editing ? existing!.visibilityRoleId : interaction.options.getRole("role")?.id ?? null;
  const scheduledAt = parseDateTime(time!);
  const signupDeadline = parseDateTime(deadline!);
  if (signupDeadline >= scheduledAt) throw new Error("報名截止時間必須早於活動時間。");
  const draft = await makeDraft(interaction, editing ? "PARTY_EDIT" : "PARTY_CREATE", { id, name, scheduledAt: scheduledAt.toISOString(), signupDeadline: signupDeadline.toISOString(), capacity, roleId });
  const modal = new ModalBuilder().setCustomId(`party_form:${draft.id}`).setTitle(editing ? "編輯 Party" : "建立 Party").addComponents(
    textInput("public_area", "公開區域（城市／行政區）", TextInputStyle.Short, true, 100, existing?.publicArea),
    textInput("private_location", "詳細地點（只給正式參加者）", TextInputStyle.Short, true, 200, existing?.privateLocation),
    textInput("description", "Party 說明與注意事項", TextInputStyle.Paragraph, true, 1500, existing?.description)
  );
  await interaction.showModal(modal);
}

async function myActivities(interaction: ChatInputCommandInteraction) {
  await requireEligible(prisma, interaction.guildId!, interaction.user.id);
  const [dates, applications, parties, attendance] = await Promise.all([
    prisma.datePost.findMany({ where: { guildId: interaction.guildId!, creatorId: interaction.user.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.dateApplication.findMany({ where: { applicantId: interaction.user.id, datePost: { guildId: interaction.guildId! } }, include: { datePost: true }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.party.findMany({ where: { guildId: interaction.guildId!, creatorId: interaction.user.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.partyAttendance.findMany({ where: { userId: interaction.user.id, party: { guildId: interaction.guildId! } }, include: { party: true }, orderBy: { createdAt: "desc" }, take: 10 })
  ]);
  const lines = [
    "**我發布的約會**", ...dates.map(x => `• ${x.activity}｜${x.status}｜\`${x.id}\``),
    "**我的約會申請**", ...applications.map(x => `• ${x.datePost.activity}｜${x.status}｜\`${x.datePostId}\``),
    "**我發布的 Party**", ...parties.map(x => `• ${x.name}｜${x.status}｜\`${x.id}\``),
    "**我的 Party 報名**", ...attendance.map(x => `• ${x.party.name}｜${x.status}｜\`${x.partyId}\``)
  ];
  await interaction.reply({ content: lines.join("\n").slice(0, 1900), ephemeral: true });
}

export async function handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) throw new Error("此指令只能在伺服器中使用。");
  switch (interaction.commandName) {
    case "setup": return setup(interaction);
    case "開始使用": {
      if (!interaction.options.getBoolean("確認", true)) throw new Error("必須確認年滿 18 歲並同意規範才能使用。");
      await prisma.userConsent.upsert({ where: { guildId_userId: { guildId: interaction.guildId, userId: interaction.user.id } }, create: { guildId: interaction.guildId, userId: interaction.user.id }, update: { acceptedAt: new Date(), rulesVersion: "1" } });
      await interaction.reply({ content: "已記錄你的自我聲明。這不是身分或年齡驗證；請遵守伺服器規範並保護個人安全。", ephemeral: true }); return;
    }
    case "date": {
      const sub = interaction.options.getSubcommand();
      if (sub === "create") return createDateModal(interaction);
      if (sub === "edit") return createDateModal(interaction, true);
      const id = interaction.options.getString("id", true);
      const post = await prisma.datePost.findFirst({ where: { id, guildId: interaction.guildId, creatorId: interaction.user.id } });
      if (!post) throw new Error("找不到約會或你不是發起者。");
      await cancelDate(interaction, id); return;
    }
    case "party": {
      const sub = interaction.options.getSubcommand();
      if (sub === "create") return createPartyModal(interaction);
      if (sub === "edit") return createPartyModal(interaction, true);
      await cancelParty(interaction, interaction.options.getString("id", true)); return;
    }
    case "我的活動": return myActivities(interaction);
    case "block": {
      const target = interaction.options.getUser("user", true); if (target.id === interaction.user.id || target.bot) throw new Error("無法封鎖這個使用者。");
      await prisma.userBlock.upsert({ where: { guildId_blockerId_blockedId: { guildId: interaction.guildId, blockerId: interaction.user.id, blockedId: target.id } }, create: { guildId: interaction.guildId, blockerId: interaction.user.id, blockedId: target.id }, update: {} });
      await interaction.reply({ content: "已封鎖該使用者。", ephemeral: true }); return;
    }
    case "unblock": {
      const target = interaction.options.getUser("user", true);
      await prisma.userBlock.deleteMany({ where: { guildId: interaction.guildId, blockerId: interaction.user.id, blockedId: target.id } });
      await interaction.reply({ content: "已解除封鎖。", ephemeral: true }); return;
    }
    case "report": return report(interaction);
    case "privacy": return deletePrivacy(interaction);
    case "moderate": return moderate(interaction);
  }
}

export async function cancelDate(interaction: ChatInputCommandInteraction, id: string) {
  const post = await prisma.datePost.findFirst({ where: { id, guildId: interaction.guildId!, creatorId: interaction.user.id, status: { in: [ActivityStatus.OPEN, ActivityStatus.MATCHING, ActivityStatus.MATCHED] } }, include: { applications: true } });
  if (!post) throw new Error("找不到可取消的約會，或你不是發起者。");
  await prisma.$transaction([
    prisma.datePost.update({ where: { id }, data: { status: ActivityStatus.CANCELLED, closedAt: new Date(), matchingAppId: null } }),
    prisma.dateApplication.updateMany({ where: { datePostId: id, status: { in: ["PENDING", "MATCHING", "ACCEPTED"] } }, data: { status: "CANCELLED" } })
  ]);
  await interaction.reply({ content: "約會已取消，參與者將收到通知。", ephemeral: true });
  for (const app of post.applications) interaction.guild && interaction.guild.client.users.fetch(app.applicantId).then(u => u.send(`約會「${post.activity}」已由發起者取消。`)).catch(() => undefined);
}

export async function cancelParty(interaction: ChatInputCommandInteraction, id: string) {
  const party = await prisma.party.findFirst({ where: { id, guildId: interaction.guildId!, creatorId: interaction.user.id, status: ActivityStatus.OPEN }, include: { attendees: true } });
  if (!party) throw new Error("找不到可取消的 Party，或你不是發起者。");
  await prisma.$transaction([
    prisma.party.update({ where: { id }, data: { status: ActivityStatus.CANCELLED, closedAt: new Date() } }),
    prisma.partyAttendance.updateMany({ where: { partyId: id, status: { in: ["GOING", "WAITLISTED"] } }, data: { status: "CANCELLED", queueNumber: null } })
  ]);
  await interaction.reply({ content: "Party 已取消，參與者將收到通知。", ephemeral: true });
  for (const x of party.attendees) interaction.guild && interaction.guild.client.users.fetch(x.userId).then(u => u.send(`Party「${party.name}」已由發起者取消。`)).catch(() => undefined);
}

async function report(interaction: ChatInputCommandInteraction) {
  const target = interaction.options.getUser("user", true); if (target.id === interaction.user.id) throw new Error("不能檢舉自己。");
  const cfg = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guildId! } }); if (!cfg) throw new Error("伺服器尚未完成設定。");
  const item = await prisma.report.create({ data: { guildId: interaction.guildId!, reporterId: interaction.user.id, reportedUserId: target.id, reason: interaction.options.getString("reason", true), evidence: interaction.options.getString("evidence") } });
  const channel = await interaction.guild!.channels.fetch(cfg.moderationChannelId);
  if (channel?.isTextBased()) await channel.send({ embeds: [new EmbedBuilder().setColor(0xff5555).setTitle(`新檢舉 ${item.id}`).addFields({ name: "檢舉者", value: `<@${interaction.user.id}>` }, { name: "被檢舉者", value: `<@${target.id}>` }, { name: "原因", value: item.reason }, { name: "證據", value: item.evidence || "未提供" }).setTimestamp()] });
  await interaction.reply({ content: `檢舉已送出，案件編號：\`${item.id}\`。`, ephemeral: true });
}

async function moderate(interaction: ChatInputCommandInteraction) {
  if (!(interaction.member as GuildMember).permissions.has(PermissionFlagsBits.ModerateMembers)) throw new Error("需要管理成員權限。");
  const target = interaction.options.getUser("user", true); const action = interaction.options.getString("action", true) as ModerationActionType;
  const hours = interaction.options.getInteger("hours");
  if (action === ModerationActionType.SUSPEND && !hours) throw new Error("暫停處置必須提供時數。");
  const reportId = interaction.options.getString("report_id");
  if (reportId && !(await prisma.report.findFirst({ where: { id: reportId, guildId: interaction.guildId! } }))) throw new Error("找不到此伺服器的檢舉案件。");
  await prisma.$transaction(async tx => {
    await tx.moderationAction.create({ data: { guildId: interaction.guildId!, moderatorId: interaction.user.id, targetUserId: target.id, action, reason: interaction.options.getString("reason", true), reportId, expiresAt: hours ? new Date(Date.now() + hours * 3_600_000) : null } });
    if (reportId) await tx.report.update({ where: { id: reportId }, data: { status: "RESOLVED", resolvedAt: new Date() } });
    if (action === ModerationActionType.REMOVE_CONTENT) {
      await tx.datePost.updateMany({ where: { guildId: interaction.guildId!, creatorId: target.id, status: { in: ["OPEN", "MATCHING"] } }, data: { status: "CLOSED", closedAt: new Date() } });
      await tx.party.updateMany({ where: { guildId: interaction.guildId!, creatorId: target.id, status: "OPEN" }, data: { status: "CLOSED", closedAt: new Date() } });
    }
  });
  await interaction.reply({ content: `已記錄對 <@${target.id}> 的 ${action} 處置。`, ephemeral: true });
}

async function deletePrivacy(interaction: ChatInputCommandInteraction) {
  if (!interaction.options.getBoolean("confirm", true)) throw new Error("你必須確認刪除。");
  const openReports = await prisma.report.count({ where: { guildId: interaction.guildId!, status: "OPEN", OR: [{ reporterId: interaction.user.id }, { reportedUserId: interaction.user.id }] } });
  await prisma.$transaction(async tx => {
    await tx.dateApplication.deleteMany({ where: { applicantId: interaction.user.id, datePost: { guildId: interaction.guildId! } } });
    await tx.partyAttendance.deleteMany({ where: { userId: interaction.user.id, party: { guildId: interaction.guildId! } } });
    await tx.datePost.deleteMany({ where: { guildId: interaction.guildId!, creatorId: interaction.user.id } });
    await tx.party.deleteMany({ where: { guildId: interaction.guildId!, creatorId: interaction.user.id } });
    await tx.userBlock.deleteMany({ where: { guildId: interaction.guildId!, OR: [{ blockerId: interaction.user.id }, { blockedId: interaction.user.id }] } });
    await tx.userConsent.deleteMany({ where: { guildId: interaction.guildId!, userId: interaction.user.id } });
    await tx.rateLimitEvent.deleteMany({ where: { guildId: interaction.guildId!, userId: interaction.user.id } });
  });
  await interaction.reply({ content: `一般活動資料已刪除。${openReports ? `另有 ${openReports} 件未結案件及相關管理紀錄依法規與社群安全政策保留。` : ""}`, ephemeral: true });
}
