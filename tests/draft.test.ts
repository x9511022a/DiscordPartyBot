import { describe, expect, it } from "vitest";
import { isDraftUsable } from "../src/ui/draft.js";

describe("互動草稿所有權", () => {
  const draft = { guildId: "伺服器一", userId: "使用者一", kind: "建立約會", expiresAt: new Date("2026-08-13T03:00:00Z") };
  const now = new Date("2026-08-13T02:00:00Z");

  it("只有同伺服器、同使用者及正確類型可操作", () => {
    expect(isDraftUsable(draft, "伺服器一", "使用者一", ["建立約會"], now)).toBe(true);
    expect(isDraftUsable(draft, "伺服器二", "使用者一", undefined, now)).toBe(false);
    expect(isDraftUsable(draft, "伺服器一", "使用者二", undefined, now)).toBe(false);
    expect(isDraftUsable(draft, "伺服器一", "使用者一", ["建立派對"], now)).toBe(false);
  });

  it("過期草稿不可操作", () => {
    expect(isDraftUsable(draft, "伺服器一", "使用者一", undefined, new Date("2026-08-13T04:00:00Z"))).toBe(false);
  });
});
