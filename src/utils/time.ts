export function parseDateTime(value: string, now = new Date()): Date {
  const normalized = value.trim().replace(" ", "T");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("日期格式錯誤，請使用 ISO 8601，例如 2026-09-01T19:30+08:00。");
  }
  if (parsed <= now) throw new Error("日期時間必須在未來。");
  return parsed;
}

export function discordTime(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:F>`;
}
