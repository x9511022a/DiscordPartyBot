import { describe, expect, it } from "vitest";
import { availableDates, DATE_PAGE_SIZE, MINUTE_OPTIONS, selectionToDate } from "../src/ui/time-picker.js";

describe("視覺時間選擇器", () => {
  const now = new Date("2026-08-13T02:00:00.000Z");

  it("每頁最多顯示 14 天且不同頁不重複", () => {
    const first = availableDates(now, 0);
    const second = availableDates(now, 1);
    expect(first).toHaveLength(DATE_PAGE_SIZE);
    expect(second).toHaveLength(DATE_PAGE_SIZE);
    expect(first.at(-1)?.value).not.toBe(second[0]?.value);
  });

  it("分鐘固定使用 15 分鐘粒度", () => {
    expect(MINUTE_OPTIONS).toEqual([0, 15, 30, 45]);
  });

  it("以台北時區將選擇轉為 UTC 時間", () => {
    expect(selectionToDate({ date: "2026-08-14", hour: 19, minute: 30 }, now).toISOString()).toBe("2026-08-14T11:30:00.000Z");
  });

  it("拒絕過去、未完成及超過 90 天的選擇", () => {
    expect(() => selectionToDate({ date: "2026-08-13", hour: 9, minute: 0 }, now)).toThrow("晚於現在");
    expect(() => selectionToDate({ date: "2026-08-14", hour: 9 }, now)).toThrow("完成");
    expect(() => selectionToDate({ date: "2026-12-31", hour: 9, minute: 0 }, now)).toThrow("90 天");
  });
});
