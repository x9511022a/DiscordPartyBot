import {
  ActivityStatus, AttendanceStatus, ModerationActionType, Prisma, ReportStatus
} from "@prisma/client";
import {
  ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, EmbedBuilder, Guild, GuildMember,
  ModalBuilder, ModalSubmitInteraction, PermissionFlagsBits, StringSelectMenuBuilder,
  StringSelectMenuInteraction, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
  UserSelectMenuInteraction
} from "discord.js";
import { prisma } from "../db.js";
import { requireEligible } from "../services/policy.js";
import { consumeRateLimit } from "../services/rate-limit.js";
import { partyCounts } from "../services/party.js";
import { resolveGuild, safeDm } from "../utils/discord.js";
import { dateMessage, partyMessage } from "../views.js";
import { activityStatusLabels, attendanceStatusLabels, moderationActionLabels } from "../ui/labels.js";
import { mainPanelView } from "../ui/panels.js";
import { selectionToDate, timePickerView, type TimeSelection } from "../ui/time-picker.js";
import { discordTime } from "../utils/time.js";
import { isDraftUsable } from "../ui/draft.js";
import { assertSignupBeforeEvent } from "../domain/rules.js";

const activityLabel = (status: string) => activityStatusLabels[status] ?? status;
const attendanceLabel = (status: string) => attendanceStatusLabels[status] ?? status;

type DraftPayload = Record<string, unknown> & { selection?: TimeSelection; eventSelection?: TimeSelection; scheduledAt?: string };
type PanelInteraction = ButtonInteraction | StringSelectMenuInteraction | UserSelectMenuInteraction | ModalSubmitInteraction;

function input(id: string, label: string, style = TextInputStyle.Short, required = true, maxLength = 1000, value?: string) {
  const field = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(maxLength);
  if (value) field.setValue(value.slice(0, maxLength));
  return new ActionRowBuilder<TextInputBuilder>().addComponents(field);
}

async function createDraft(guildId: string, userId: string, kind: string, payload: Prisma.InputJsonValue = {}) {
  return prisma.interactionDraft.create({ data: { guildId, userId, kind, payload, expiresAt: new Date(Date.now() + 30 * 60_000) } });
}

async function getDraft(interaction: PanelInteraction, id: string, kinds?: string[]) {
  const draft = await prisma.interactionDraft.findUnique({ where: { id } });
  if (!isDraftUsable(draft, interaction.guildId!, interaction.user.id, kinds)) throw new Error("這個操作已逾時或不屬於你，請從私人選單重新開始。");
  return draft!;
}

async function updateDraft(id: string, payload: DraftPayload) {
  return prisma.interactionDraft.update({ where: { id }, data: { payload: payload as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + 30 * 60_000) } });
}

async function refreshMain(interaction: ButtonInteraction) {
  const guild = await resolveGuild(interaction);
  const [config, consent, member] = await Promise.all([
    prisma.guildConfig.findUnique({ where: { guildId: interaction.guildId! } }),
    prisma.userConsent.findUnique({ where: { guildId_userId: { guildId: interaction.guildId!, userId: interaction.user.id } } }),
    guild.members.fetch(interaction.user.id)
  ]);
  if (!config) throw new Error("伺服器尚未完成 `/設定 頻道`。");
  return mainPanelView(config, Boolean(consent), member);
}

function dateDetailsModal(customId: string, title: string, current?: { activity: string; publicArea: string; privateLocation: string; cost: string; desiredPerson: string }) {
  return new ModalBuilder().setCustomId(customId).setTitle(title).addComponents(
    input("活動內容", "活動內容", TextInputStyle.Short, true, 100, current?.activity),
    input("公開區域", "公開區域（城市／行政區）", TextInputStyle.Short, true, 100, current?.publicArea),
    input("詳細地點", "詳細地點（不會公開）", TextInputStyle.Short, true, 200, current?.privateLocation),
    input("費用方式", "費用方式", TextInputStyle.Short, true, 100, current?.cost),
    input("希望對象", "希望對象與注意事項", TextInputStyle.Paragraph, true, 700, current?.desiredPerson)
  );
}

function partyDetailsModal(customId: string, title: string, current?: { name: string; publicArea: string; privateLocation: string; description: string; capacity: number }) {
  return new ModalBuilder().setCustomId(customId).setTitle(title).addComponents(
    input("派對名稱", "派對名稱", TextInputStyle.Short, true, 100, current?.name),
    input("公開區域", "公開區域（城市／行政區）", TextInputStyle.Short, true, 100, current?.publicArea),
    input("詳細地點", "詳細地點（只給正式參加者）", TextInputStyle.Short, true, 200, current?.privateLocation),
    input("活動說明", "活動說明與注意事項", TextInputStyle.Paragraph, true, 1500, current?.description),
    input("參加名額", "參加名額（1～200，不含發起者）", TextInputStyle.Short, true, 3, current ? String(current.capacity) : undefined)
  );
}

async function showMyActivities(interaction: ButtonInteraction) {
  await requireEligible(prisma, interaction.guildId!, interaction.user.id);
  const [dates, parties, attending] = await Promise.all([
    prisma.datePost.findMany({ where: { guildId: interaction.guildId!, creatorId: interaction.user.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.party.findMany({ where: { guildId: interaction.guildId!, creatorId: interaction.user.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.partyAttendance.findMany({ where: { userId: interaction.user.id, party: { guildId: interaction.guildId! }, status: { in: [AttendanceStatus.GOING, AttendanceStatus.WAITLISTED] } }, include: { party: true }, orderBy: { createdAt: "desc" }, take: 5 })
  ]);
  const options = [
    ...dates.map(item => ({ label: `約會｜${item.activity}`.slice(0, 100), description: `${activityLabel(item.status)}｜${item.publicArea}`.slice(0, 100), value: `約會:${item.id}` })),
    ...parties.map(item => ({ label: `派對｜${item.name}`.slice(0, 100), description: `${activityLabel(item.status)}｜${item.publicArea}`.slice(0, 100), value: `派對:${item.id}` })),
    ...attending.map(item => ({ label: `參加｜${item.party.name}`.slice(0, 100), description: attendanceLabel(item.status), value: `參加:${item.partyId}` }))
  ].slice(0, 25);
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("📋 我的活動")
    .setDescription(options.length ? "從下拉選單選擇活動以查看或管理。" : "目前沒有活動紀錄。");
  const components = options.length ? [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId("活動選擇").setPlaceholder("選擇一個活動").addOptions(options)
  )] : [];
  await interaction.update({ embeds: [embed], components });
}

function safetyView() {
  return { embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🛡️ 安全與隱私中心")
    .setDescription("封鎖後雙方無法互相申請活動；檢舉只會送至管理團隊。刪除個資不會刪除未結案件。")],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("安全封鎖").setLabel("封鎖使用者").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("安全解除封鎖").setLabel("解除封鎖").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("安全檢舉").setLabel("檢舉使用者").setStyle(ButtonStyle.Danger)
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("個資刪除").setLabel("刪除我的一般資料").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("返回主選單").setLabel("返回主選單").setStyle(ButtonStyle.Secondary)
      )
    ] };
}

function userPicker(customId: string, title: string, description: string) {
  return { embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(title).setDescription(description)], components: [
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(new UserSelectMenuBuilder().setCustomId(customId).setPlaceholder("選擇使用者").setMinValues(1).setMaxValues(1)),
    new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("安全中心").setLabel("返回安全中心").setStyle(ButtonStyle.Secondary))
  ] };
}

async function adminView(interaction: ButtonInteraction) {
  const guild = await resolveGuild(interaction);
  const member = await guild.members.fetch(interaction.user.id);
  if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) throw new Error("你沒有管理成員權限。");
  const reports = await prisma.report.findMany({ where: { guildId: interaction.guildId!, status: ReportStatus.OPEN }, orderBy: { createdAt: "asc" }, take: 25 });
  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
  if (reports.length) rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId("管理檢舉選擇").setPlaceholder("選擇待處理案件").addOptions(reports.map(report => ({ label: `案件 ${report.id.slice(-8)}`, description: report.reason.slice(0, 100), value: report.id })))
  ));
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("管理選擇使用者").setLabel("直接處置使用者").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("返回主選單").setLabel("返回主選單").setStyle(ButtonStyle.Secondary)
  ));
  await interaction.update({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🔧 管理員中心").setDescription(`待處理檢舉：**${reports.length}** 件`)], components: rows });
}

async function updatePublicDate(guild: Guild, id: string) {
  const post = await prisma.datePost.findUnique({ where: { id } });
  if (!post?.channelId || !post.messageId) return;
  const channel = await guild.channels.fetch(post.channelId).catch(() => null);
  if (channel?.isTextBased()) await channel.messages.fetch(post.messageId).then(message => message.edit(dateMessage(post, post.status !== ActivityStatus.OPEN))).catch(() => undefined);
}

async function updatePublicParty(guild: Guild, id: string) {
  const party = await prisma.party.findUnique({ where: { id } });
  if (!party?.channelId || !party.messageId) return;
  const channel = await guild.channels.fetch(party.channelId).catch(() => null);
  if (channel?.isTextBased()) {
    const counts = await partyCounts(id);
    await channel.messages.fetch(party.messageId).then(message => message.edit(partyMessage(party, counts.going, counts.waiting, party.status !== ActivityStatus.OPEN))).catch(() => undefined);
  }
}

export async function handlePanelButton(interaction: ButtonInteraction): Promise<boolean> {
  const id = interaction.customId;
  const known = ["面板開啟", "重新整理選單", "返回主選單", "同意規範", "建立約會", "建立派對", "我的活動", "安全中心", "安全封鎖", "安全解除封鎖", "安全檢舉", "個資刪除", "個資確認刪除", "管理中心", "管理選擇使用者"];
  if (!known.includes(id) && !id.startsWith("時間") && !id.startsWith("精靈放棄:") && !id.startsWith("精靈返回:") && !id.startsWith("活動取消:") && !id.startsWith("活動編輯內容:") && !id.startsWith("活動編輯時間:") && !id.startsWith("處理案件:")) return false;
  if (!interaction.guildId) throw new Error("此操作只能在伺服器中使用。");
  if (id === "面板開啟") {
    const guild = await resolveGuild(interaction);
    const [config, consent, member] = await Promise.all([
      prisma.guildConfig.findUnique({ where: { guildId: interaction.guildId } }),
      prisma.userConsent.findUnique({ where: { guildId_userId: { guildId: interaction.guildId, userId: interaction.user.id } } }), guild.members.fetch(interaction.user.id)
    ]);
    if (!config) throw new Error("伺服器尚未完成設定。");
    await interaction.reply({ ...mainPanelView(config, Boolean(consent), member), ephemeral: true }); return true;
  }
  if (["重新整理選單", "返回主選單"].includes(id)) { await interaction.update(await refreshMain(interaction)); return true; }
  if (id === "同意規範") {
    await prisma.userConsent.upsert({ where: { guildId_userId: { guildId: interaction.guildId, userId: interaction.user.id } }, create: { guildId: interaction.guildId, userId: interaction.user.id }, update: { acceptedAt: new Date(), rulesVersion: "1" } });
    await interaction.update(await refreshMain(interaction)); return true;
  }
  if (id === "建立約會") {
    await requireEligible(prisma, interaction.guildId, interaction.user.id); await consumeRateLimit(prisma, interaction.guildId, interaction.user.id, "DATE_CREATE");
    const draft = await createDraft(interaction.guildId, interaction.user.id, "建立約會");
    await interaction.showModal(dateDetailsModal(`約會資料:${draft.id}`, "建立約會")); return true;
  }
  if (id === "建立派對") {
    await requireEligible(prisma, interaction.guildId, interaction.user.id); await consumeRateLimit(prisma, interaction.guildId, interaction.user.id, "PARTY_CREATE");
    const draft = await createDraft(interaction.guildId, interaction.user.id, "建立派對");
    await interaction.showModal(partyDetailsModal(`派對資料:${draft.id}`, "建立派對")); return true;
  }
  if (id === "我的活動") { await showMyActivities(interaction); return true; }
  if (id === "安全中心") { await interaction.update(safetyView()); return true; }
  if (id === "安全封鎖") { await interaction.update(userPicker("選擇封鎖", "封鎖使用者", "選擇後，雙方將無法互相申請活動。")); return true; }
  if (id === "安全解除封鎖") { await interaction.update(userPicker("選擇解除封鎖", "解除封鎖", "選擇要解除封鎖的使用者。")); return true; }
  if (id === "安全檢舉") { await interaction.update(userPicker("選擇檢舉", "檢舉使用者", "選擇被檢舉者，下一步將填寫原因。")); return true; }
  if (id === "個資刪除") {
    await interaction.update({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("確認刪除個資").setDescription("這會刪除一般活動、報名、封鎖及成年聲明資料，且無法復原。未結檢舉與管理紀錄仍會保留。")], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("個資確認刪除").setLabel("確認永久刪除").setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId("安全中心").setLabel("返回").setStyle(ButtonStyle.Secondary)
    )] }); return true;
  }
  if (id === "個資確認刪除") { await deletePrivacy(interaction); return true; }
  if (id === "管理中心") { await adminView(interaction); return true; }
  if (id === "管理選擇使用者") {
    const guild = await resolveGuild(interaction); const member = await guild.members.fetch(interaction.user.id);
    if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) throw new Error("你沒有管理成員權限。");
    await interaction.update(userPicker("管理目標使用者", "選擇處置對象", "選擇要警告、暫停、封禁或下架內容的使用者。")); return true;
  }
  if (id.startsWith("精靈放棄:")) { await prisma.interactionDraft.deleteMany({ where: { id: id.split(":")[1], userId: interaction.user.id } }); await interaction.update(await refreshMain(interaction)); return true; }
  if (id.startsWith("精靈返回:")) { await returnWizard(interaction, id.split(":")[1]!); return true; }
  if (id.startsWith("時間")) { await handleTimeButton(interaction); return true; }
  if (id.startsWith("活動取消:")) { await cancelActivity(interaction, id); return true; }
  if (id.startsWith("活動編輯內容:")) { await editActivityContent(interaction, id); return true; }
  if (id.startsWith("活動編輯時間:")) { await editActivityTime(interaction, id); return true; }
  if (id.startsWith("處理案件:")) { await showReportAction(interaction, id.split(":")[1]!); return true; }
  return true;
}

async function returnWizard(interaction: ButtonInteraction, draftId: string) {
  const draft = await getDraft(interaction, draftId);
  const payload = draft.payload as DraftPayload;
  if (draft.kind === "建立約會") {
    await interaction.showModal(dateDetailsModal(`約會資料:${draft.id}`, "返回編輯約會資料", {
      activity: String(payload.activity ?? ""), publicArea: String(payload.publicArea ?? ""), privateLocation: String(payload.privateLocation ?? ""), cost: String(payload.cost ?? ""), desiredPerson: String(payload.desiredPerson ?? "")
    })); return;
  }
  if (draft.kind === "建立派對") {
    await interaction.showModal(partyDetailsModal(`派對資料:${draft.id}`, "返回編輯派對資料", {
      name: String(payload.name ?? ""), publicArea: String(payload.publicArea ?? ""), privateLocation: String(payload.privateLocation ?? ""), description: String(payload.description ?? ""), capacity: Number(payload.capacity ?? 1)
    })); return;
  }
  await prisma.interactionDraft.delete({ where: { id: draft.id } });
  await interaction.update({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("已返回活動管理").setDescription("請從「我的活動」重新選擇要管理的活動。")], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("我的活動").setLabel("我的活動").setStyle(ButtonStyle.Primary))] });
}

export async function showManagedActivityFromPost(interaction: ButtonInteraction, type: "約會" | "派對", id: string): Promise<void> {
  if (!interaction.guildId) throw new Error("此操作只能在伺服器中使用。");
  if (type === "約會") {
    const post = await prisma.datePost.findFirst({ where: { id, guildId: interaction.guildId, creatorId: interaction.user.id } });
    if (!post) throw new Error("只有發起者可以管理這個約會。");
    await interaction.reply({ ephemeral: true, embeds: [new EmbedBuilder().setColor(0xe879a9).setTitle(`約會｜${post.activity}`).addFields(
      { name: "狀態", value: activityLabel(post.status) }, { name: "時間", value: discordTime(post.scheduledAt) }, { name: "區域", value: post.publicArea }
    )], components: post.status === ActivityStatus.OPEN ? activityManageRows("約會", post.id) : [] });
    return;
  }
  const party = await prisma.party.findFirst({ where: { id, guildId: interaction.guildId, creatorId: interaction.user.id } });
  if (!party) throw new Error("只有發起者可以管理這個派對。");
  await interaction.reply({ ephemeral: true, embeds: [new EmbedBuilder().setColor(0x7c5cff).setTitle(`派對｜${party.name}`).addFields(
    { name: "狀態", value: activityLabel(party.status) }, { name: "時間", value: discordTime(party.scheduledAt) }, { name: "區域", value: party.publicArea }
  )], components: party.status === ActivityStatus.OPEN ? activityManageRows("派對", party.id) : [] });
}

async function handleTimeButton(interaction: ButtonInteraction) {
  const [action, draftId, phase = "活動"] = interaction.customId.split(":");
  const draft = await getDraft(interaction, draftId!);
  const payload = draft.payload as DraftPayload;
  const key = phase === "截止" ? "selection" : draft.kind.includes("派對") && payload.eventSelection ? "selection" : "selection";
  let selection = { ...(payload[key] as TimeSelection | undefined), page: (payload[key] as TimeSelection | undefined)?.page ?? 0 };
  if (action === "時間上一頁") selection.page = Math.max(0, (selection.page ?? 0) - 1);
  if (action === "時間下一頁") selection.page = (selection.page ?? 0) + 1;
  if (action === "時間重選") selection = { page: selection.page };
  payload[key] = selection;
  await updateDraft(draft.id, payload);
  if (action !== "時間確認") { await interaction.update(timePickerView(draft.id, phase === "截止" ? "選擇報名截止時間" : "選擇活動時間", selection, phase)); return; }
  const chosen = selectionToDate(selection);
  if (draft.kind === "建立約會") return finishDateCreate(interaction, draft.id, payload, chosen);
  if (draft.kind === "編輯約會時間") return finishDateTimeEdit(interaction, draft.id, payload, chosen);
  if (draft.kind === "建立派對" || draft.kind === "編輯派對時間") {
    if (phase !== "截止") {
      payload.scheduledAt = chosen.toISOString(); payload.eventSelection = selection; payload.selection = {};
      await updateDraft(draft.id, payload);
      await interaction.update(timePickerView(draft.id, "選擇報名截止時間", {}, "截止")); return;
    }
    assertSignupBeforeEvent(chosen, new Date(String(payload.scheduledAt)));
    if (draft.kind === "編輯派對時間") return finishPartyTimeEdit(interaction, draft.id, payload, chosen);
    return showPartyVisibility(interaction, draft.id, payload, chosen);
  }
}

async function finishDateCreate(interaction: ButtonInteraction, draftId: string, payload: DraftPayload, scheduledAt: Date) {
  const guild = await resolveGuild(interaction); const config = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guildId! } });
  if (!config) throw new Error("伺服器尚未完成設定。");
  const channel = await guild.channels.fetch(config.dateChannelId); if (!channel?.isTextBased()) throw new Error("約會頻道無法使用。");
  const post = await prisma.datePost.create({ data: { guildId: interaction.guildId!, creatorId: interaction.user.id, channelId: channel.id, scheduledAt, publicArea: String(payload.publicArea), privateLocation: String(payload.privateLocation), activity: String(payload.activity), cost: String(payload.cost), desiredPerson: String(payload.desiredPerson), notes: null } });
  try { const message = await channel.send(dateMessage(post)); await prisma.datePost.update({ where: { id: post.id }, data: { messageId: message.id } }); await prisma.interactionDraft.delete({ where: { id: draftId } }); await interaction.update({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("✅ 約會已發布").setDescription(`[前往貼文](${message.url})\n時間：${discordTime(scheduledAt)}`)], components: [] }); }
  catch (error) { await prisma.datePost.delete({ where: { id: post.id } }); throw error; }
}

async function showPartyVisibility(interaction: ButtonInteraction, draftId: string, payload: DraftPayload, deadline: Date) {
  payload.signupDeadline = deadline.toISOString(); await updateDraft(draftId, payload);
  const config = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guildId! }, include: { rolePartyChannels: true } }); if (!config) throw new Error("伺服器尚未完成設定。");
  const options = [{ label: "公開派對", value: "公開", description: "所有可查看公開派對頻道的成員皆可參加" }, ...config.rolePartyChannels.slice(0, 24).map(item => ({ label: `身分組限定 ${item.roleId}`, value: item.roleId, description: "發布至身分組專屬頻道" }))];
  await interaction.update({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("選擇派對可見範圍").setDescription(`活動：${discordTime(new Date(String(payload.scheduledAt)))}\n截止：${discordTime(deadline)}`)], components: [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`派對範圍:${draftId}`).setPlaceholder("選擇可見範圍").addOptions(options)),
    new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`精靈放棄:${draftId}`).setLabel("放棄").setStyle(ButtonStyle.Danger))
  ] });
}

async function finishDateTimeEdit(interaction: ButtonInteraction, draftId: string, payload: DraftPayload, scheduledAt: Date) {
  const post = await prisma.datePost.findFirst({ where: { id: String(payload.id), guildId: interaction.guildId!, creatorId: interaction.user.id, status: ActivityStatus.OPEN } }); if (!post) throw new Error("找不到可編輯的約會。");
  await prisma.datePost.update({ where: { id: post.id }, data: { scheduledAt } }); await prisma.interactionDraft.delete({ where: { id: draftId } }); await updatePublicDate(await resolveGuild(interaction), post.id);
  await interaction.update({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("✅ 約會時間已更新").setDescription(discordTime(scheduledAt))], components: [] });
}

async function finishPartyTimeEdit(interaction: ButtonInteraction, draftId: string, payload: DraftPayload, deadline: Date) {
  const party = await prisma.party.findFirst({ where: { id: String(payload.id), guildId: interaction.guildId!, creatorId: interaction.user.id, status: ActivityStatus.OPEN } }); if (!party) throw new Error("找不到可編輯的派對。");
  await prisma.party.update({ where: { id: party.id }, data: { scheduledAt: new Date(String(payload.scheduledAt)), signupDeadline: deadline } }); await prisma.interactionDraft.delete({ where: { id: draftId } }); await updatePublicParty(await resolveGuild(interaction), party.id);
  await interaction.update({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("✅ 派對時間已更新")], components: [] });
}

export async function handlePanelSelect(interaction: StringSelectMenuInteraction): Promise<boolean> {
  if (!interaction.guildId) return false;
  const id = interaction.customId;
  if (id.startsWith("時間")) {
    const [action, draftId, phase = "活動"] = id.split(":"); const draft = await getDraft(interaction, draftId!); const payload = draft.payload as DraftPayload; const selection = { ...(payload.selection ?? {}) };
    if (action === "時間日期") selection.date = interaction.values[0];
    if (action === "時間小時") selection.hour = Number(interaction.values[0]);
    if (action === "時間分鐘") selection.minute = Number(interaction.values[0]);
    payload.selection = selection; await updateDraft(draft.id, payload); await interaction.update(timePickerView(draft.id, phase === "截止" ? "選擇報名截止時間" : "選擇活動時間", selection, phase)); return true;
  }
  if (id === "派對範圍") return false;
  if (id.startsWith("派對範圍:")) { await finishPartyCreate(interaction, id.split(":")[1]!, interaction.values[0]!); return true; }
  if (id === "活動選擇") { await showActivity(interaction, interaction.values[0]!); return true; }
  if (id === "管理檢舉選擇") { await showReport(interaction, interaction.values[0]!); return true; }
  if (id.startsWith("管理處置選擇:")) { await beginModeration(interaction, id.split(":")[1]!, interaction.values[0]!, id.split(":")[2]); return true; }
  return false;
}

async function finishPartyCreate(interaction: StringSelectMenuInteraction, draftId: string, visibility: string) {
  const draft = await getDraft(interaction, draftId, ["建立派對"]); const payload = draft.payload as DraftPayload;
  const config = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guildId! }, include: { rolePartyChannels: true } }); if (!config) throw new Error("伺服器尚未完成設定。");
  const roleChannel = visibility === "公開" ? null : config.rolePartyChannels.find(item => item.roleId === visibility); if (visibility !== "公開" && !roleChannel) throw new Error("這個身分組頻道設定已失效。");
  const guild = await resolveGuild(interaction); const channel = await guild.channels.fetch(roleChannel?.channelId ?? config.publicPartyChannelId); if (!channel?.isTextBased()) throw new Error("派對頻道無法使用。");
  const capacity = Number(payload.capacity); const party = await prisma.party.create({ data: { guildId: interaction.guildId!, creatorId: interaction.user.id, channelId: channel.id, visibilityRoleId: visibility === "公開" ? null : visibility, name: String(payload.name), scheduledAt: new Date(String(payload.scheduledAt)), signupDeadline: new Date(String(payload.signupDeadline)), publicArea: String(payload.publicArea), privateLocation: String(payload.privateLocation), description: String(payload.description), capacity } });
  try { const message = await channel.send(partyMessage(party, 0, 0)); await prisma.party.update({ where: { id: party.id }, data: { messageId: message.id } }); await prisma.interactionDraft.delete({ where: { id: draft.id } }); await interaction.update({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("✅ 派對已發布").setDescription(`[前往貼文](${message.url})`)], components: [] }); }
  catch (error) { await prisma.party.delete({ where: { id: party.id } }); throw error; }
}

async function showActivity(interaction: StringSelectMenuInteraction, value: string) {
  const [type, id] = value.split(":");
  if (type === "約會") {
    const post = await prisma.datePost.findFirst({ where: { id, guildId: interaction.guildId!, creatorId: interaction.user.id } }); if (!post) throw new Error("找不到活動。");
    await interaction.update({ embeds: [new EmbedBuilder().setColor(0xe879a9).setTitle(`約會｜${post.activity}`).addFields({ name: "狀態", value: activityLabel(post.status) }, { name: "時間", value: discordTime(post.scheduledAt) }, { name: "區域", value: post.publicArea })], components: post.status === ActivityStatus.OPEN ? activityManageRows("約會", post.id) : [] }); return;
  }
  const party = await prisma.party.findFirst({ where: { id, guildId: interaction.guildId!, ...(type === "派對" ? { creatorId: interaction.user.id } : {}) } }); if (!party) throw new Error("找不到活動。");
  const attendance = type === "參加" ? await prisma.partyAttendance.findUnique({ where: { partyId_userId: { partyId: party.id, userId: interaction.user.id } } }) : null;
  await interaction.update({ embeds: [new EmbedBuilder().setColor(0x7c5cff).setTitle(`派對｜${party.name}`).addFields({ name: "狀態", value: activityLabel(party.status) }, { name: "時間", value: discordTime(party.scheduledAt) }, { name: "區域", value: party.publicArea }, ...(attendance ? [{ name: "我的報名", value: attendanceLabel(attendance.status) }] : []))], components: type === "派對" && party.status === ActivityStatus.OPEN ? activityManageRows("派對", party.id) : [] });
}

function activityManageRows(type: string, id: string) { return [new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder().setCustomId(`活動編輯內容:${type}:${id}`).setLabel("編輯內容").setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId(`活動編輯時間:${type}:${id}`).setLabel("編輯時間").setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId(`活動取消:${type}:${id}`).setLabel("取消活動").setStyle(ButtonStyle.Danger),
  new ButtonBuilder().setCustomId("我的活動").setLabel("返回清單").setStyle(ButtonStyle.Secondary)
)]; }

async function cancelActivity(interaction: ButtonInteraction, customId: string) {
  const [, type, id] = customId.split(":"); const guild = await resolveGuild(interaction);
  if (type === "約會") {
    const post = await prisma.datePost.findFirst({ where: { id, guildId: interaction.guildId!, creatorId: interaction.user.id, status: { in: [ActivityStatus.OPEN, ActivityStatus.MATCHED] } }, include: { applications: true } }); if (!post) throw new Error("找不到可取消的約會。");
    await prisma.$transaction([prisma.datePost.update({ where: { id: post.id }, data: { status: ActivityStatus.CANCELLED, closedAt: new Date(), matchingAppId: null } }), prisma.dateApplication.updateMany({ where: { datePostId: post.id, status: { in: ["PENDING", "MATCHING", "ACCEPTED"] } }, data: { status: "CANCELLED" } })]);
    for (const application of post.applications) await safeDm(guild, application.applicantId, `約會「${post.activity}」已取消。`); await updatePublicDate(guild, post.id);
  } else {
    const party = await prisma.party.findFirst({ where: { id, guildId: interaction.guildId!, creatorId: interaction.user.id, status: ActivityStatus.OPEN }, include: { attendees: true } }); if (!party) throw new Error("找不到可取消的派對。");
    await prisma.$transaction([prisma.party.update({ where: { id: party.id }, data: { status: ActivityStatus.CANCELLED, closedAt: new Date() } }), prisma.partyAttendance.updateMany({ where: { partyId: party.id, status: { in: [AttendanceStatus.GOING, AttendanceStatus.WAITLISTED] } }, data: { status: AttendanceStatus.CANCELLED, queueNumber: null } })]);
    for (const attendee of party.attendees) await safeDm(guild, attendee.userId, `派對「${party.name}」已取消。`); await updatePublicParty(guild, party.id);
  }
  await interaction.update({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("✅ 活動已取消")], components: [] });
}

async function editActivityContent(interaction: ButtonInteraction, customId: string) {
  const [, type, id] = customId.split(":");
  if (type === "約會") { const post = await prisma.datePost.findFirst({ where: { id, guildId: interaction.guildId!, creatorId: interaction.user.id, status: ActivityStatus.OPEN } }); if (!post) throw new Error("找不到可編輯的約會。"); await interaction.showModal(dateDetailsModal(`約會編輯:${post.id}`, "編輯約會內容", post)); }
  else { const party = await prisma.party.findFirst({ where: { id, guildId: interaction.guildId!, creatorId: interaction.user.id, status: ActivityStatus.OPEN } }); if (!party) throw new Error("找不到可編輯的派對。"); await interaction.showModal(partyDetailsModal(`派對編輯:${party.id}`, "編輯派對內容", party)); }
}

async function editActivityTime(interaction: ButtonInteraction, customId: string) {
  const [, type, id] = customId.split(":"); const kind = type === "約會" ? "編輯約會時間" : "編輯派對時間";
  const draft = await createDraft(interaction.guildId!, interaction.user.id, kind, { id }); await interaction.update(timePickerView(draft.id, "選擇新的活動時間", {}, "活動"));
}

export async function handlePanelUserSelect(interaction: UserSelectMenuInteraction): Promise<boolean> {
  if (!interaction.guildId) return false; const targetId = interaction.values[0]!; if (targetId === interaction.user.id) throw new Error("不能選擇自己。");
  if (interaction.customId === "選擇封鎖") { await prisma.userBlock.upsert({ where: { guildId_blockerId_blockedId: { guildId: interaction.guildId, blockerId: interaction.user.id, blockedId: targetId } }, create: { guildId: interaction.guildId, blockerId: interaction.user.id, blockedId: targetId }, update: {} }); await interaction.update({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("✅ 已封鎖使用者")], components: [] }); return true; }
  if (interaction.customId === "選擇解除封鎖") { await prisma.userBlock.deleteMany({ where: { guildId: interaction.guildId, blockerId: interaction.user.id, blockedId: targetId } }); await interaction.update({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("✅ 已解除封鎖")], components: [] }); return true; }
  if (interaction.customId === "選擇檢舉") { const draft = await createDraft(interaction.guildId, interaction.user.id, "檢舉", { targetId }); await interaction.showModal(new ModalBuilder().setCustomId(`檢舉資料:${draft.id}`).setTitle("檢舉使用者").addComponents(input("原因", "檢舉原因", TextInputStyle.Paragraph, true, 1000), input("證據", "訊息連結或補充證據（選填）", TextInputStyle.Paragraph, false, 1000))); return true; }
  if (interaction.customId === "管理目標使用者") { const guild = await resolveGuild(interaction); const member = await guild.members.fetch(interaction.user.id); if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) throw new Error("你沒有管理權限。"); await showModerationChoices(interaction, targetId); return true; }
  return false;
}

async function showModerationChoices(interaction: UserSelectMenuInteraction, targetId: string) {
  const options = Object.entries(moderationActionLabels).map(([value, label]) => ({ label, value }));
  await interaction.update({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("選擇處置").setDescription(`目標：<@${targetId}>`)], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`管理處置選擇:${targetId}`).setPlaceholder("選擇處置方式").addOptions(options))] });
}

async function showReport(interaction: StringSelectMenuInteraction, reportId: string) {
  const report = await prisma.report.findFirst({ where: { id: reportId, guildId: interaction.guildId!, status: ReportStatus.OPEN } }); if (!report) throw new Error("案件不存在或已結案。");
  await interaction.update({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle(`檢舉案件 ${report.id}`).addFields({ name: "檢舉者", value: `<@${report.reporterId}>` }, { name: "被檢舉者", value: `<@${report.reportedUserId}>` }, { name: "原因", value: report.reason }, { name: "證據", value: report.evidence || "未提供" })], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`處理案件:${report.id}`).setLabel("處理案件").setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId("管理中心").setLabel("返回").setStyle(ButtonStyle.Secondary))] });
}

async function showReportAction(interaction: ButtonInteraction, reportId: string) {
  const guild = await resolveGuild(interaction);
  const member = await guild.members.fetch(interaction.user.id);
  if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) throw new Error("你沒有管理成員權限。");
  const report = await prisma.report.findFirst({ where: { id: reportId, guildId: interaction.guildId!, status: ReportStatus.OPEN } }); if (!report) throw new Error("案件不存在或已結案。");
  await interaction.update({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("選擇案件處置")], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`管理處置選擇:${report.reportedUserId}:${report.id}`).setPlaceholder("選擇處置方式").addOptions(Object.entries(moderationActionLabels).map(([value, label]) => ({ value, label }))))] });
}

async function beginModeration(interaction: StringSelectMenuInteraction, targetId: string, action: string, reportId?: string) {
  const draft = await createDraft(interaction.guildId!, interaction.user.id, "管理處置", { targetId, action, reportId: reportId || null });
  await interaction.showModal(new ModalBuilder().setCustomId(`管理處置資料:${draft.id}`).setTitle(moderationActionLabels[action] ?? "管理處置").addComponents(input("原因", "處置原因", TextInputStyle.Paragraph, true, 1000), input("暫停時數", "暫停時數（只有暫停使用時必填）", TextInputStyle.Short, false, 4)));
}

async function deletePrivacy(interaction: ButtonInteraction) {
  const openReports = await prisma.report.count({ where: { guildId: interaction.guildId!, status: ReportStatus.OPEN, OR: [{ reporterId: interaction.user.id }, { reportedUserId: interaction.user.id }] } });
  await prisma.$transaction(async tx => { await tx.dateApplication.deleteMany({ where: { applicantId: interaction.user.id, datePost: { guildId: interaction.guildId! } } }); await tx.partyAttendance.deleteMany({ where: { userId: interaction.user.id, party: { guildId: interaction.guildId! } } }); await tx.datePost.deleteMany({ where: { guildId: interaction.guildId!, creatorId: interaction.user.id } }); await tx.party.deleteMany({ where: { guildId: interaction.guildId!, creatorId: interaction.user.id } }); await tx.userBlock.deleteMany({ where: { guildId: interaction.guildId!, OR: [{ blockerId: interaction.user.id }, { blockedId: interaction.user.id }] } }); await tx.userConsent.deleteMany({ where: { guildId: interaction.guildId!, userId: interaction.user.id } }); await tx.rateLimitEvent.deleteMany({ where: { guildId: interaction.guildId!, userId: interaction.user.id } }); });
  await interaction.update({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("✅ 一般資料已刪除").setDescription(openReports ? `另有 ${openReports} 件未結案件及相關管理紀錄保留。` : "")], components: [] });
}

export async function handlePanelModal(interaction: ModalSubmitInteraction): Promise<boolean> {
  if (!interaction.guildId) return false; const [kind, id] = interaction.customId.split(":");
  if (kind === "約會資料") { const draft = await getDraft(interaction, id!, ["建立約會"]); const payload: DraftPayload = { activity: interaction.fields.getTextInputValue("活動內容").trim(), publicArea: interaction.fields.getTextInputValue("公開區域").trim(), privateLocation: interaction.fields.getTextInputValue("詳細地點").trim(), cost: interaction.fields.getTextInputValue("費用方式").trim(), desiredPerson: interaction.fields.getTextInputValue("希望對象").trim(), selection: {} }; await updateDraft(draft.id, payload); await interaction.reply({ ...timePickerView(draft.id, "選擇約會時間", {}, "活動"), ephemeral: true }); return true; }
  if (kind === "派對資料") { const draft = await getDraft(interaction, id!, ["建立派對"]); const capacity = Number(interaction.fields.getTextInputValue("參加名額")); if (!Number.isInteger(capacity) || capacity < 1 || capacity > 200) throw new Error("參加名額必須是 1～200 的整數。"); const payload: DraftPayload = { name: interaction.fields.getTextInputValue("派對名稱").trim(), publicArea: interaction.fields.getTextInputValue("公開區域").trim(), privateLocation: interaction.fields.getTextInputValue("詳細地點").trim(), description: interaction.fields.getTextInputValue("活動說明").trim(), capacity, selection: {} }; await updateDraft(draft.id, payload); await interaction.reply({ ...timePickerView(draft.id, "選擇派對時間", {}, "活動"), ephemeral: true }); return true; }
  if (kind === "約會編輯") { const post = await prisma.datePost.findFirst({ where: { id, guildId: interaction.guildId, creatorId: interaction.user.id, status: ActivityStatus.OPEN } }); if (!post) throw new Error("找不到可編輯的約會。"); await prisma.datePost.update({ where: { id: post.id }, data: { activity: interaction.fields.getTextInputValue("活動內容").trim(), publicArea: interaction.fields.getTextInputValue("公開區域").trim(), privateLocation: interaction.fields.getTextInputValue("詳細地點").trim(), cost: interaction.fields.getTextInputValue("費用方式").trim(), desiredPerson: interaction.fields.getTextInputValue("希望對象").trim() } }); await updatePublicDate(await resolveGuild(interaction), post.id); await interaction.reply({ content: "✅ 約會內容已更新。", ephemeral: true }); return true; }
  if (kind === "派對編輯") { const party = await prisma.party.findFirst({ where: { id, guildId: interaction.guildId, creatorId: interaction.user.id, status: ActivityStatus.OPEN } }); if (!party) throw new Error("找不到可編輯的派對。"); const capacity = Number(interaction.fields.getTextInputValue("參加名額")); const going = await prisma.partyAttendance.count({ where: { partyId: party.id, status: AttendanceStatus.GOING } }); if (!Number.isInteger(capacity) || capacity < Math.max(1, going) || capacity > 200) throw new Error(`名額必須是 ${Math.max(1, going)}～200 的整數。`); await prisma.party.update({ where: { id: party.id }, data: { name: interaction.fields.getTextInputValue("派對名稱").trim(), publicArea: interaction.fields.getTextInputValue("公開區域").trim(), privateLocation: interaction.fields.getTextInputValue("詳細地點").trim(), description: interaction.fields.getTextInputValue("活動說明").trim(), capacity } }); await updatePublicParty(await resolveGuild(interaction), party.id); await interaction.reply({ content: "✅ 派對內容已更新。", ephemeral: true }); return true; }
  if (kind === "檢舉資料") { const draft = await getDraft(interaction, id!, ["檢舉"]); const payload = draft.payload as DraftPayload; const config = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guildId } }); if (!config) throw new Error("伺服器尚未完成設定。"); const report = await prisma.report.create({ data: { guildId: interaction.guildId, reporterId: interaction.user.id, reportedUserId: String(payload.targetId), reason: interaction.fields.getTextInputValue("原因").trim(), evidence: interaction.fields.getTextInputValue("證據").trim() || null } }); const guild = await resolveGuild(interaction); const channel = await guild.channels.fetch(config.moderationChannelId); if (channel?.isTextBased()) await channel.send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle(`新檢舉案件 ${report.id}`).addFields({ name: "檢舉者", value: `<@${report.reporterId}>` }, { name: "被檢舉者", value: `<@${report.reportedUserId}>` }, { name: "原因", value: report.reason }, { name: "證據", value: report.evidence || "未提供" })], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`處理案件:${report.id}`).setLabel("處理案件").setStyle(ButtonStyle.Danger))] }); await prisma.interactionDraft.delete({ where: { id: draft.id } }); await interaction.reply({ content: `✅ 檢舉已送出，案件編號：${report.id}`, ephemeral: true }); return true; }
  if (kind === "管理處置資料") { await finishModeration(interaction, id!); return true; }
  return false;
}

async function finishModeration(interaction: ModalSubmitInteraction, draftId: string) {
  const guild = await resolveGuild(interaction); const member = await guild.members.fetch(interaction.user.id); if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) throw new Error("你沒有管理權限。");
  const draft = await getDraft(interaction, draftId, ["管理處置"]); const payload = draft.payload as DraftPayload; const action = String(payload.action) as ModerationActionType; const hoursText = interaction.fields.getTextInputValue("暫停時數").trim(); const hours = hoursText ? Number(hoursText) : null; if (action === ModerationActionType.SUSPEND && (!hours || !Number.isInteger(hours) || hours < 1 || hours > 8760)) throw new Error("暫停使用時必須填寫 1～8760 小時。");
  const reportId = payload.reportId ? String(payload.reportId) : null;
  await prisma.$transaction(async tx => { await tx.moderationAction.create({ data: { guildId: interaction.guildId!, moderatorId: interaction.user.id, targetUserId: String(payload.targetId), reportId, action, reason: interaction.fields.getTextInputValue("原因").trim(), expiresAt: hours ? new Date(Date.now() + hours * 3_600_000) : null } }); if (reportId) await tx.report.update({ where: { id: reportId }, data: { status: ReportStatus.RESOLVED, resolvedAt: new Date() } }); if (action === ModerationActionType.REMOVE_CONTENT) { await tx.datePost.updateMany({ where: { guildId: interaction.guildId!, creatorId: String(payload.targetId), status: { in: [ActivityStatus.OPEN, ActivityStatus.MATCHING] } }, data: { status: ActivityStatus.CLOSED, closedAt: new Date() } }); await tx.party.updateMany({ where: { guildId: interaction.guildId!, creatorId: String(payload.targetId), status: ActivityStatus.OPEN }, data: { status: ActivityStatus.CLOSED, closedAt: new Date() } }); } });
  await prisma.interactionDraft.delete({ where: { id: draft.id } }); await interaction.reply({ content: `✅ 已執行「${moderationActionLabels[action]}」。`, ephemeral: true });
}
