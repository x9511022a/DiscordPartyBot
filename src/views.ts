import type { DatePost, Party } from "@prisma/client";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { customId } from "./utils/custom-id.js";
import { discordTime } from "./utils/time.js";

export function dateMessage(post: DatePost, disabled = false) {
  const embed = new EmbedBuilder().setColor(post.status === "OPEN" ? 0xe879a9 : 0x777777)
    .setTitle(`💗 約會徵求｜${post.activity}`)
    .setDescription(post.notes || "無其他注意事項")
    .addFields(
      { name: "時間", value: discordTime(post.scheduledAt), inline: true },
      { name: "區域", value: post.publicArea, inline: true },
      { name: "費用方式", value: post.cost, inline: true },
      { name: "希望對象", value: post.desiredPerson },
      { name: "發起者", value: `<@${post.creatorId}>`, inline: true },
      { name: "約會編號", value: `\`${post.id}\``, inline: true }
    ).setFooter({ text: "詳細地點只會在接受申請後提供" }).setTimestamp(post.createdAt);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(customId("date_apply", post.id)).setLabel("申請").setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(customId("date_manage", post.id)).setLabel("管理活動").setStyle(ButtonStyle.Secondary).setDisabled(disabled)
  );
  return { embeds: [embed], components: [row] };
}

export function partyMessage(party: Party, going: number, waiting: number, disabled = false) {
  const embed = new EmbedBuilder().setColor(party.status === "OPEN" ? 0x7c5cff : 0x777777)
    .setTitle(`🎉 ${party.name}`)
    .setDescription(party.description)
    .addFields(
      { name: "時間", value: discordTime(party.scheduledAt), inline: true },
      { name: "報名截止", value: discordTime(party.signupDeadline), inline: true },
      { name: "區域", value: party.publicArea, inline: true },
      { name: "名額", value: `${going}/${party.capacity}（候補 ${waiting}）`, inline: true },
      { name: "發起者", value: `<@${party.creatorId}>`, inline: true },
      { name: "派對編號", value: `\`${party.id}\``, inline: true }
    ).setFooter({ text: "詳細地點只傳給正式參加者" }).setTimestamp(party.createdAt);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(customId("party_join", party.id)).setLabel("參加／候補").setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(customId("party_leave", party.id)).setLabel("退出").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(customId("party_manage", party.id)).setLabel("管理活動").setStyle(ButtonStyle.Secondary).setDisabled(disabled)
  );
  return { embeds: [embed], components: [row] };
}
