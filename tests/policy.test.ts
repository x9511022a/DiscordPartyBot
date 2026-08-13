import { describe, expect, it, vi } from "vitest";
import { isBlockedEitherWay } from "../src/services/policy.js";

describe("雙向封鎖", () => {
  it("任一方封鎖即視為不可互動", async () => {
    const count = vi.fn().mockResolvedValue(1);
    const db = { userBlock: { count } };
    await expect(isBlockedEitherWay(db as never, "guild", "a", "b")).resolves.toBe(true);
    expect(count).toHaveBeenCalledWith({ where: { guildId: "guild", OR: [{ blockerId: "a", blockedId: "b" }, { blockerId: "b", blockedId: "a" }] } });
  });

  it("雙方皆未封鎖時可互動", async () => {
    const db = { userBlock: { count: vi.fn().mockResolvedValue(0) } };
    await expect(isBlockedEitherWay(db as never, "guild", "a", "b")).resolves.toBe(false);
  });
});
