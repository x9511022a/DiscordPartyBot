import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder
} from "discord.js";
import { discordTime } from "../utils/time.js";

export const TAIPEI_OFFSET = "+08:00";
export const DATE_PAGE_SIZE = 14;
export const MAX_DATE_DAYS = 90;
export const MINUTE_OPTIONS = [0, 15, 30, 45] as const;

export type TimeSelection = { date?: string; hour?: number; minute?: number; page?: number };

function taipeiDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find(part => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

export function dateKey(date: Date): string {
  const { year, month, day } = taipeiDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function availableDates(now = new Date(), page = 0): Array<{ value: string; label: string }> {
  const formatter = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "long", day: "numeric", weekday: "short" });
  const start = page * DATE_PAGE_SIZE;
  return Array.from({ length: Math.min(DATE_PAGE_SIZE, MAX_DATE_DAYS - start) }, (_, index) => {
    const date = new Date(now.getTime() + (start + index) * 86_400_000);
    return { value: dateKey(date), label: formatter.format(date) };
  });
}

export function selectionToDate(selection: TimeSelection, now = new Date()): Date {
  if (!selection.date || selection.hour === undefined || selection.minute === undefined) throw new Error("請先完成日期、時與分的選擇。");
  const date = new Date(`${selection.date}T${String(selection.hour).padStart(2, "0")}:${String(selection.minute).padStart(2, "0")}:00${TAIPEI_OFFSET}`);
  if (Number.isNaN(date.getTime()) || date <= now) throw new Error("選擇的時間必須晚於現在。");
  const latest = new Date(now.getTime() + MAX_DATE_DAYS * 86_400_000);
  if (date > latest) throw new Error("只能選擇未來 90 天內的時間。");
  return date;
}

export function timePickerView(draftId: string, title: string, selection: TimeSelection, phase: string) {
  const page = Math.max(0, Math.min(selection.page ?? 0, Math.ceil(MAX_DATE_DAYS / DATE_PAGE_SIZE) - 1));
  let preview = "尚未完成選擇";
  try { preview = discordTime(selectionToDate(selection)); } catch { /* incomplete selection */ }
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(`🗓️ ${title}`)
    .setDescription(`請依序選擇日期、時、分。\n\n**目前選擇：** ${preview}`)
    .setFooter({ text: `日期第 ${page + 1} 頁／共 ${Math.ceil(MAX_DATE_DAYS / DATE_PAGE_SIZE)} 頁｜台北時間` });
  const dateSelect = new StringSelectMenuBuilder().setCustomId(`時間日期:${draftId}:${phase}`).setPlaceholder("選擇日期")
    .addOptions(availableDates(new Date(), page).map(option => ({ ...option, default: option.value === selection.date })));
  const hourSelect = new StringSelectMenuBuilder().setCustomId(`時間小時:${draftId}:${phase}`).setPlaceholder("選擇小時")
    .addOptions(Array.from({ length: 24 }, (_, hour) => ({ label: `${String(hour).padStart(2, "0")} 時`, value: String(hour), default: hour === selection.hour })));
  const minuteSelect = new StringSelectMenuBuilder().setCustomId(`時間分鐘:${draftId}:${phase}`).setPlaceholder("選擇分鐘")
    .addOptions(MINUTE_OPTIONS.map(minute => ({ label: `${String(minute).padStart(2, "0")} 分`, value: String(minute), default: minute === selection.minute })));
  const navigation = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`時間上一頁:${draftId}:${phase}`).setLabel("上一頁").setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(`時間下一頁:${draftId}:${phase}`).setLabel("下一頁").setStyle(ButtonStyle.Secondary).setDisabled((page + 1) * DATE_PAGE_SIZE >= MAX_DATE_DAYS)
  );
  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`精靈返回:${draftId}`).setLabel("返回上一步").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`時間重選:${draftId}:${phase}`).setLabel("重新選擇").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`時間確認:${draftId}:${phase}`).setLabel("確認時間").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`精靈放棄:${draftId}`).setLabel("放棄").setStyle(ButtonStyle.Danger)
  );
  return { embeds: [embed], components: [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(dateSelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(hourSelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(minuteSelect), navigation, controls
  ] };
}
