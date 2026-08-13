import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, GuildMember, PermissionFlagsBits
} from "discord.js";
import type { GuildConfig } from "@prisma/client";

export function publicPanelView() {
  return {
    embeds: [new EmbedBuilder().setColor(0xe879a9).setTitle("💗 DiscordPartyBot")
      .setDescription("尋找約會、建立派對並管理你的活動。\n\n所有個人操作都會在只有你看得到的私人面板中進行。")
      .addFields(
        { name: "約會", value: "發布徵求、私下申請與雙方媒合", inline: true },
        { name: "派對", value: "揪團、候補與自動遞補", inline: true },
        { name: "安全", value: "18+ 規範、封鎖及檢舉機制", inline: true }
      ).setFooter({ text: "點擊下方按鈕開啟私人操作面板" })],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("面板開啟").setLabel("開啟私人選單").setEmoji("✨").setStyle(ButtonStyle.Primary)
    )]
  };
}

export function mainPanelView(config: GuildConfig, consented: boolean, member?: GuildMember) {
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("DiscordPartyBot 私人選單")
    .setDescription(consented
      ? "請選擇你要使用的功能。這個面板只有你看得到。"
      : "開始前請先確認年滿 18 歲並同意社群規範。")
    .addFields({ name: "使用資格", value: consented ? "✅ 已完成 18+ 自我聲明" : "⚠️ 尚未確認" });
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  if (!consented) rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("同意規範").setLabel("我已滿 18 歲並同意規範").setStyle(ButtonStyle.Success)
  ));
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("建立約會").setLabel("建立約會").setEmoji("💗").setStyle(ButtonStyle.Primary).setDisabled(!consented),
    new ButtonBuilder().setCustomId("建立派對").setLabel("建立派對").setEmoji("🎉").setStyle(ButtonStyle.Primary).setDisabled(!consented),
    new ButtonBuilder().setCustomId("我的活動").setLabel("我的活動").setEmoji("📋").setStyle(ButtonStyle.Secondary).setDisabled(!consented)
  ));
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("安全中心").setLabel("安全與隱私").setEmoji("🛡️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("重新整理選單").setLabel("重新整理").setStyle(ButtonStyle.Secondary)
  ));
  const links = new ActionRowBuilder<ButtonBuilder>();
  if (config.dateChannelId) links.addComponents(new ButtonBuilder().setLabel("前往約會頻道").setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${config.guildId}/${config.dateChannelId}`));
  if (config.publicPartyChannelId) links.addComponents(new ButtonBuilder().setLabel("前往派對頻道").setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${config.guildId}/${config.publicPartyChannelId}`));
  rows.push(links);
  if (member?.permissions.has(PermissionFlagsBits.ModerateMembers)) rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("管理中心").setLabel("管理員中心").setEmoji("🔧").setStyle(ButtonStyle.Danger)
  ));
  return { embeds: [embed], components: rows };
}
