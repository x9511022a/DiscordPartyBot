import { describe, expect, it } from "vitest";
import { discordTime, parseDateTime } from "../src/utils/time.js";

describe("日期驗證", () => {
  const now = new Date("2026-08-12T00:00:00.000Z");

  it("接受含時區的未來 ISO 日期", () => {
    expect(parseDateTime("2026-09-01T19:30+08:00", now).toISOString()).toBe("2026-09-01T11:30:00.000Z");
  });

  it("拒絕過去日期與無效日期", () => {
    expect(() => parseDateTime("2026-01-01T00:00Z", now)).toThrow("未來");
    expect(() => parseDateTime("明天下午", now)).toThrow("格式錯誤");
  });

  it("產生 Discord 時間標記", () => {
    expect(discordTime(new Date("1970-01-01T00:01:40Z"))).toBe("<t:100:F>");
  });
});
