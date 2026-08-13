import { AttendanceStatus, ModerationActionType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { assertConsent, assertModerationEligibility, canReserveDate, nextPartyStatus } from "../src/domain/rules.js";

describe("資格與狀態規則", () => {
  it("未完成 18+ 自我聲明時拒絕操作", () => {
    expect(() => assertConsent(false)).toThrow("/開始使用");
    expect(() => assertConsent(true)).not.toThrow();
  });

  it("封禁及有效暫停不可操作，解除狀態可操作", () => {
    const now = new Date("2026-08-12T00:00:00Z");
    expect(() => assertModerationEligibility(ModerationActionType.BAN, null, now)).toThrow("禁止");
    expect(() => assertModerationEligibility(ModerationActionType.SUSPEND, new Date("2026-08-13T00:00:00Z"), now)).toThrow("暫停");
    expect(() => assertModerationEligibility(ModerationActionType.SUSPEND, new Date("2026-08-11T00:00:00Z"), now)).not.toThrow();
    expect(() => assertModerationEligibility(ModerationActionType.UNBAN, null, now)).not.toThrow();
  });

  it("名額未滿時正式參加，額滿時候補", () => {
    expect(nextPartyStatus(4, 5)).toBe(AttendanceStatus.GOING);
    expect(nextPartyStatus(5, 5)).toBe(AttendanceStatus.WAITLISTED);
  });

  it("只有 OPEN 貼文與 PENDING 申請可取得媒合鎖", () => {
    expect(canReserveDate("OPEN", "PENDING")).toBe(true);
    expect(canReserveDate("MATCHING", "PENDING")).toBe(false);
    expect(canReserveDate("OPEN", "ACCEPTED")).toBe(false);
  });
});
