export type DraftIdentity = { guildId: string; userId: string; expiresAt: Date; kind: string };

export function isDraftUsable(
  draft: DraftIdentity | null,
  guildId: string,
  userId: string,
  allowedKinds?: string[],
  now = new Date()
): boolean {
  return Boolean(draft && draft.guildId === guildId && draft.userId === userId && draft.expiresAt > now && (!allowedKinds || allowedKinds.includes(draft.kind)));
}
