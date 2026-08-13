import {
  ChannelType, ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits
} from "discord.js";
import { prisma } from "../db.js";
import { assertPrivateHub, resolveGuild } from "../utils/discord.js";
import { mainPanelView, publicPanelView } from "../ui/panels.js";

async function publishPanel(interaction: ChatInputCommandInteraction, panelChannelId: string, oldChannelId?: string | null, oldMessageId?: string | null) {
  const guild = await resolveGuild(interaction);
  const channel = await guild.channels.fetch(panelChannelId);
  if (!channel || channel.type !== ChannelType.GuildText) throw new Error("操作面板頻道必須是文字頻道。");
  if (oldChannelId && oldMessageId) {
    const oldChannel = await guild.channels.fetch(oldChannelId).catch(() => null);
    const oldMessage = oldChannel?.isTextBased() ? await oldChannel.messages.fetch(oldMessageId).catch(() => null) : null;
    if (oldMessage && oldChannelId === panelChannelId) {
      await oldMessage.edit(publicPanelView());
      return oldMessage.id;
    }
    if (oldMessage) await oldMessage.delete().catch(() => undefined);
  }
  const message = await channel.send(publicPanelView());
  return message.id;
}

async function handleSetup(interaction: ChatInputCommandInteraction) {
  const guild = await resolveGuild(interaction);
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new Error("你需要「管理伺服器」權限。");
  const subcommand = interaction.options.getSubcommand();
  const existing = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guildId! }, include: { rolePartyChannels: true } });
  if (subcommand === "頻道") {
    await interaction.deferReply({ ephemeral: true });
    const panel = interaction.options.getChannel("操作面板", true);
    const date = interaction.options.getChannel("約會貼文", true);
    const party = interaction.options.getChannel("公開派對", true);
    const hub = interaction.options.getChannel("私人媒合", true);
    const moderation = interaction.options.getChannel("管理紀錄", true);
    await assertPrivateHub(guild, hub.id);
    const panelMessageId = await publishPanel(interaction, panel.id, existing?.panelChannelId, existing?.panelMessageId);
    await prisma.guildConfig.upsert({
      where: { guildId: interaction.guildId! },
      create: { guildId: interaction.guildId!, panelChannelId: panel.id, panelMessageId, dateChannelId: date.id, publicPartyChannelId: party.id, matchHubChannelId: hub.id, moderationChannelId: moderation.id },
      update: { panelChannelId: panel.id, panelMessageId, dateChannelId: date.id, publicPartyChannelId: party.id, matchHubChannelId: hub.id, moderationChannelId: moderation.id }
    });
    await interaction.editReply(`✅ 頻道設定完成，常駐面板已發布至 <#${panel.id}>。`);
    return;
  }
  if (!existing) throw new Error("請先執行 `/設定 頻道`。");
  if (subcommand === "身分組頻道") {
    const role = interaction.options.getRole("身分組", true);
    const selected = interaction.options.getChannel("頻道", true);
    const channel = await guild.channels.fetch(selected.id);
    if (!channel || channel.type !== ChannelType.GuildText) throw new Error("必須選擇文字頻道。");
    const everyoneCanView = channel.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel);
    const roleCanView = channel.permissionsFor(role.id)?.has(PermissionFlagsBits.ViewChannel);
    if (everyoneCanView || !roleCanView) throw new Error("此頻道必須禁止 @everyone 查看，並允許指定身分組查看。");
    await prisma.rolePartyChannel.upsert({
      where: { guildId_roleId: { guildId: interaction.guildId!, roleId: role.id } },
      create: { guildId: interaction.guildId!, roleId: role.id, channelId: channel.id }, update: { channelId: channel.id }
    });
    await interaction.reply({ content: `✅ 已將 <@&${role.id}> 對應至 <#${channel.id}>。`, ephemeral: true });
    return;
  }
  const roles = existing.rolePartyChannels.map(item => `<@&${item.roleId}> → <#${item.channelId}>`).join("\n") || "尚未設定";
  await interaction.reply({ ephemeral: true, embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("DiscordPartyBot 頻道設定").addFields(
    { name: "操作面板", value: existing.panelChannelId ? `<#${existing.panelChannelId}>` : "尚未設定", inline: true },
    { name: "約會貼文", value: `<#${existing.dateChannelId}>`, inline: true },
    { name: "公開派對", value: `<#${existing.publicPartyChannelId}>`, inline: true },
    { name: "私人媒合", value: `<#${existing.matchHubChannelId}>`, inline: true },
    { name: "管理紀錄", value: `<#${existing.moderationChannelId}>`, inline: true },
    { name: "身分組頻道", value: roles }
  )] });
}

export async function replyMainPanel(interaction: ChatInputCommandInteraction) {
  const guild = await resolveGuild(interaction);
  const config = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guildId! } });
  if (!config) throw new Error("伺服器尚未完成 `/設定 頻道`。");
  const [consent, member] = await Promise.all([
    prisma.userConsent.findUnique({ where: { guildId_userId: { guildId: interaction.guildId!, userId: interaction.user.id } } }),
    guild.members.fetch(interaction.user.id)
  ]);
  await interaction.reply({ ...mainPanelView(config, Boolean(consent), member), ephemeral: true });
}

export async function handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) throw new Error("此指令只能在伺服器中使用。");
  if (interaction.commandName === "設定") return handleSetup(interaction);
  if (interaction.commandName === "選單") return replyMainPanel(interaction);
}
