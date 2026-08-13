import type { Guild, GuildMember } from "discord.js";
import { ChannelType, PermissionFlagsBits } from "discord.js";

export async function assertPrivateHub(guild: Guild, channelId: string): Promise<void> {
  const channel = await guild.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) throw new Error("私人媒合區必須是文字頻道。");
  const everyone = channel.permissionsFor(guild.roles.everyone);
  if (everyone?.has(PermissionFlagsBits.ViewChannel)) {
    throw new Error("私人媒合區不可讓 @everyone 看見，請先調整頻道權限。");
  }
}

export function hasRole(member: GuildMember, roleId: string | null): boolean {
  return !roleId || member.roles.cache.has(roleId);
}

export async function safeDm(guild: Guild, userId: string, content: string): Promise<boolean> {
  try {
    const user = await guild.client.users.fetch(userId);
    await user.send(content);
    return true;
  } catch {
    return false;
  }
}
