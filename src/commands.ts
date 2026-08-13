import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("setup").setDescription("設定機器人頻道與權限")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName("channels").setDescription("設定主要頻道")
      .addChannelOption(o => o.setName("date").setDescription("約會貼文頻道").addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addChannelOption(o => o.setName("party").setDescription("公開 Party 頻道").addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addChannelOption(o => o.setName("match_hub").setDescription("不可供 @everyone 查看之私人媒合區").addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addChannelOption(o => o.setName("moderation").setDescription("管理紀錄頻道").addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s => s.setName("role_channel").setDescription("新增或更新 Role 專屬 Party 頻道")
      .addRoleOption(o => o.setName("role").setDescription("可見 Role").setRequired(true))
      .addChannelOption(o => o.setName("channel").setDescription("Role 專屬文字頻道").addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s => s.setName("show").setDescription("顯示目前設定")),

  new SlashCommandBuilder().setName("開始使用").setDescription("確認年滿 18 歲並同意社群規範")
    .addBooleanOption(o => o.setName("確認").setDescription("我確認年滿 18 歲並同意社群規範").setRequired(true)),

  new SlashCommandBuilder().setName("date").setDescription("約會徵求")
    .addSubcommand(s => s.setName("create").setDescription("發布約會徵求")
      .addStringOption(o => o.setName("time").setDescription("ISO 時間，例如 2026-09-01T19:30+08:00").setRequired(true))
      .addStringOption(o => o.setName("area").setDescription("公開顯示的城市或行政區").setRequired(true)))
    .addSubcommand(s => s.setName("edit").setDescription("編輯尚未媒合的約會")
      .addStringOption(o => o.setName("id").setDescription("約會 ID").setRequired(true))
      .addStringOption(o => o.setName("time").setDescription("新的 ISO 時間").setRequired(false))
      .addStringOption(o => o.setName("area").setDescription("新的公開區域").setRequired(false)))
    .addSubcommand(s => s.setName("cancel").setDescription("取消自己的約會")
      .addStringOption(o => o.setName("id").setDescription("約會 ID").setRequired(true))),

  new SlashCommandBuilder().setName("party").setDescription("Party 揪團")
    .addSubcommand(s => s.setName("create").setDescription("建立 Party")
      .addStringOption(o => o.setName("name").setDescription("Party 名稱").setRequired(true))
      .addStringOption(o => o.setName("time").setDescription("活動 ISO 時間").setRequired(true))
      .addStringOption(o => o.setName("deadline").setDescription("報名截止 ISO 時間").setRequired(true))
      .addIntegerOption(o => o.setName("capacity").setDescription("參加名額，不含發起者").setMinValue(1).setMaxValue(200).setRequired(true))
      .addRoleOption(o => o.setName("role").setDescription("留空為公開；選擇後發布至該 Role 專屬頻道").setRequired(false)))
    .addSubcommand(s => s.setName("edit").setDescription("編輯 Party")
      .addStringOption(o => o.setName("id").setDescription("Party ID").setRequired(true))
      .addStringOption(o => o.setName("time").setDescription("新的活動 ISO 時間").setRequired(false))
      .addStringOption(o => o.setName("deadline").setDescription("新的截止 ISO 時間").setRequired(false))
      .addIntegerOption(o => o.setName("capacity").setDescription("新名額").setMinValue(1).setMaxValue(200).setRequired(false)))
    .addSubcommand(s => s.setName("cancel").setDescription("取消自己的 Party")
      .addStringOption(o => o.setName("id").setDescription("Party ID").setRequired(true))),

  new SlashCommandBuilder().setName("我的活動").setDescription("查看自己發布、申請或參加的活動"),
  new SlashCommandBuilder().setName("block").setDescription("封鎖使用者")
    .addUserOption(o => o.setName("user").setDescription("要封鎖的使用者").setRequired(true)),
  new SlashCommandBuilder().setName("unblock").setDescription("解除封鎖")
    .addUserOption(o => o.setName("user").setDescription("要解除封鎖的使用者").setRequired(true)),
  new SlashCommandBuilder().setName("report").setDescription("私下檢舉使用者")
    .addUserOption(o => o.setName("user").setDescription("被檢舉者").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("原因").setMaxLength(1000).setRequired(true))
    .addStringOption(o => o.setName("evidence").setDescription("訊息連結或補充證據").setMaxLength(1000).setRequired(false)),
  new SlashCommandBuilder().setName("privacy").setDescription("管理個人資料")
    .addSubcommand(s => s.setName("delete").setDescription("刪除一般活動資料（未結檢舉除外）")
      .addBooleanOption(o => o.setName("confirm").setDescription("確認刪除").setRequired(true))),
  new SlashCommandBuilder().setName("moderate").setDescription("管理員處置")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("user").setDescription("目標使用者").setRequired(true))
    .addStringOption(o => o.setName("action").setDescription("處置").setRequired(true)
      .addChoices(
        { name: "警告", value: "WARN" }, { name: "暫停", value: "SUSPEND" },
        { name: "封禁", value: "BAN" }, { name: "解除暫停", value: "UNSUSPEND" },
        { name: "解除封禁", value: "UNBAN" }, { name: "下架內容", value: "REMOVE_CONTENT" }))
    .addStringOption(o => o.setName("reason").setDescription("原因").setMaxLength(1000).setRequired(true))
    .addIntegerOption(o => o.setName("hours").setDescription("暫停時數；其他處置可省略").setMinValue(1).setMaxValue(8760).setRequired(false))
    .addStringOption(o => o.setName("report_id").setDescription("關聯檢舉 ID").setRequired(false))
].map(command => command.toJSON());
