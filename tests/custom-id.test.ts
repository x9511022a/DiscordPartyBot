import { describe, expect, it } from "vitest";
import { customId, parseCustomId } from "../src/utils/custom-id.js";

describe("元件 custom id", () => {
  it("可來回解析已知動作", () => {
    expect(parseCustomId(customId("party_join", "abc"))).toEqual({ action: "party_join", id: "abc" });
  });

  it("拒絕未知或多段 id", () => {
    expect(parseCustomId("delete_everything:abc")).toBeNull();
    expect(parseCustomId("party_join:abc:extra")).toBeNull();
  });
});
