import { ActivityStatus } from "@prisma/client";
import { Guild, ModalSubmitInteraction } from "discord.js";
import { prisma } from "../db.js";
import { dateMessage, partyMessage } from "../views.js";
import { partyCounts } from "../services/party.js";
import { resolveGuild } from "../utils/discord.js";

type DatePayload = { id?: string | null; scheduledAt: string; area: string };
type PartyPayload = { id?: string | null; name: string; scheduledAt: string; signupDeadline: string; capacity: number; roleId?: string | null };

async function updatePublishedMessage(channelId: string | null, messageId: string | null, guild: Guild, body: object) {
  if (!channelId || !messageId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (channel?.isTextBased()) await channel.messages.fetch(messageId).then(m => m.edit(body)).catch(() => undefined);
}

export async function handleModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guildId) throw new Error("此操作只能在伺服器中完成。");
  const guild = await resolveGuild(interaction);
  const [kind, draftId] = interaction.customId.split(":");
  if ((kind !== "date_form" && kind !== "party_form") || !draftId) throw new Error("表單已失效。");
  const draft = await prisma.interactionDraft.findFirst({ where: { id: draftId, guildId: interaction.guildId, userId: interaction.user.id } });
  if (!draft || draft.expiresAt <= new Date()) throw new Error("表單已逾時，請重新執行指令。");
  const cfg = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guildId }, include: { rolePartyChannels: true } });
  if (!cfg) throw new Error("伺服器尚未完成 `/設定 頻道`。");

  if (kind === "date_form") {
    const p = draft.payload as DatePayload;
    const data = {
      scheduledAt: new Date(p.scheduledAt), publicArea: p.area.trim(),
      activity: interaction.fields.getTextInputValue("activity").trim(),
      privateLocation: interaction.fields.getTextInputValue("private_location").trim(),
      cost: interaction.fields.getTextInputValue("cost").trim(),
      desiredPerson: interaction.fields.getTextInputValue("desired_person").trim(),
      notes: interaction.fields.getTextInputValue("notes").trim() || null
    };
    if (draft.kind === "DATE_EDIT" && p.id) {
      const post = await prisma.datePost.update({ where: { id: p.id }, data });
      await prisma.interactionDraft.delete({ where: { id: draft.id } });
      await updatePublishedMessage(post.channelId, post.messageId, guild, dateMessage(post));
      await interaction.reply({ content: `約會已更新：\`${post.id}\`。`, ephemeral: true }); return;
    }
    const channel = await guild.channels.fetch(cfg.dateChannelId);
    if (!channel?.isTextBased()) throw new Error("設定的約會頻道不存在或無法傳送訊息。");
    const post = await prisma.datePost.create({ data: { guildId: interaction.guildId, creatorId: interaction.user.id, channelId: channel.id, ...data } });
    try {
      const message = await channel.send(dateMessage(post));
      await prisma.datePost.update({ where: { id: post.id }, data: { messageId: message.id } });
      await prisma.interactionDraft.delete({ where: { id: draft.id } });
      await interaction.reply({ content: `約會已發布：${message.url}`, ephemeral: true });
    } catch (error) {
      await prisma.datePost.delete({ where: { id: post.id } }); throw error;
    }
    return;
  }

  const p = draft.payload as PartyPayload;
  const data = {
    name: p.name.trim(), scheduledAt: new Date(p.scheduledAt), signupDeadline: new Date(p.signupDeadline), capacity: p.capacity,
    visibilityRoleId: p.roleId || null,
    publicArea: interaction.fields.getTextInputValue("public_area").trim(),
    privateLocation: interaction.fields.getTextInputValue("private_location").trim(),
    description: interaction.fields.getTextInputValue("description").trim()
  };
  if (draft.kind === "PARTY_EDIT" && p.id) {
    const going = await prisma.partyAttendance.count({ where: { partyId: p.id, status: "GOING" } });
    if (data.capacity < going) throw new Error(`目前已有 ${going} 人正式參加，名額不可低於此數。`);
    const party = await prisma.party.update({ where: { id: p.id }, data });
    await prisma.interactionDraft.delete({ where: { id: draft.id } });
    const counts = await partyCounts(party.id);
    await updatePublishedMessage(party.channelId, party.messageId, guild, partyMessage(party, counts.going, counts.waiting));
    await interaction.reply({ content: `派對已更新：\`${party.id}\`。`, ephemeral: true }); return;
  }
  const roleChannel = p.roleId ? cfg.rolePartyChannels.find(x => x.roleId === p.roleId) : null;
  if (p.roleId && !roleChannel) throw new Error("此身分組尚未透過 `/設定 身分組頻道` 設定專屬頻道。");
  const channel = await guild.channels.fetch(roleChannel?.channelId ?? cfg.publicPartyChannelId);
  if (!channel?.isTextBased()) throw new Error("設定的派對頻道不存在或無法傳送訊息。");
  const party = await prisma.party.create({ data: { guildId: interaction.guildId, creatorId: interaction.user.id, channelId: channel.id, ...data } });
  try {
    const message = await channel.send(partyMessage(party, 0, 0));
    await prisma.party.update({ where: { id: party.id }, data: { messageId: message.id } });
    await prisma.interactionDraft.delete({ where: { id: draft.id } });
    await interaction.reply({ content: `派對已發布：${message.url}`, ephemeral: true });
  } catch (error) {
    await prisma.party.delete({ where: { id: party.id } }); throw error;
  }
}

export async function handleDateApplicationModal(interaction: ModalSubmitInteraction, datePostId: string): Promise<void> {
  if (!interaction.guildId) throw new Error("申請必須在伺服器內送出。");
  const { requireEligible, isBlockedEitherWay } = await import("../services/policy.js");
  const { consumeRateLimit } = await import("../services/rate-limit.js");
  await requireEligible(prisma, interaction.guildId, interaction.user.id);
  await consumeRateLimit(prisma, interaction.guildId, interaction.user.id, "DATE_APPLY");
  const post = await prisma.datePost.findFirst({ where: { id: datePostId, guildId: interaction.guildId, status: ActivityStatus.OPEN } });
  if (!post) throw new Error("此約會已停止接受申請。");
  if (post.creatorId === interaction.user.id) throw new Error("不能申請自己的約會。");
  if (await isBlockedEitherWay(prisma, interaction.guildId, post.creatorId, interaction.user.id)) throw new Error("你無法申請此約會。");
  const intro = interaction.fields.getTextInputValue("intro").trim();
  const application = await prisma.dateApplication.upsert({
    where: { datePostId_applicantId: { datePostId, applicantId: interaction.user.id } },
    create: { datePostId, applicantId: interaction.user.id, intro },
    update: { intro, status: "PENDING" }
  });
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import("discord.js");
  const row = new ActionRowBuilder<InstanceType<typeof ButtonBuilder>>().addComponents(
    new ButtonBuilder().setCustomId(`date_accept:${application.id}`).setLabel("接受").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`date_decline:${application.id}`).setLabel("拒絕").setStyle(ButtonStyle.Danger)
  );
  let delivered = true;
  try {
    const creator = await interaction.client.users.fetch(post.creatorId);
    await creator.send({ content: `你收到約會「${post.activity}」的新申請。\n申請者：<@${interaction.user.id}>\n自介：${intro}`, components: [row] });
  } catch { delivered = false; }
  await interaction.reply({ content: delivered ? "申請已私下送給發起者。" : "申請已儲存，但發起者目前無法接收私訊；請通知管理員檢查 bot 私訊設定。", ephemeral: true });
}
