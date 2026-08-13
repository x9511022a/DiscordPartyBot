import type { Client, Guild, GuildMember } from "discord.js";

export async function resolveGuild(
  interaction: { guildId: string | null; guild: Guild | null; client: Client }
): Promise<Guild> {
  if (!interaction.guildId) throw new Error("此操作只能在伺服器中使用。");
  return interaction.guild ?? interaction.client.guilds.fetch(interaction.guildId);
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
