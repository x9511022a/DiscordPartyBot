import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("設定")
    .setDescription("設定 DiscordPartyBot")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(subcommand => subcommand
      .setName("頻道")
      .setDescription("設定主要頻道並發布常駐操作面板")
      .addChannelOption(option => option.setName("操作面板").setDescription("常駐操作面板頻道").addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addChannelOption(option => option.setName("約會貼文").setDescription("約會貼文頻道").addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addChannelOption(option => option.setName("公開派對").setDescription("公開派對頻道").addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addChannelOption(option => option.setName("管理紀錄").setDescription("僅管理團隊可見的紀錄頻道").addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName("身分組頻道")
      .setDescription("設定身分組專屬派對頻道")
      .addRoleOption(option => option.setName("身分組").setDescription("可查看派對的身分組").setRequired(true))
      .addChannelOption(option => option.setName("頻道").setDescription("身分組專屬文字頻道").addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(subcommand => subcommand.setName("查看").setDescription("查看目前設定")),
  new SlashCommandBuilder().setName("選單").setDescription("開啟 DiscordPartyBot 私人操作面板")
].map(command => command.toJSON());
