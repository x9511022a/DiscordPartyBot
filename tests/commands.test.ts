import { describe, expect, it } from "vitest";
import { commands } from "../src/commands.js";

describe("繁體中文指令介面", () => {
  it("只註冊設定與選單兩個指令", () => {
    expect(commands.map(command => command.name)).toEqual(["設定", "選單"]);
  });

  it("選單不需要參數，設定參數皆為繁體中文", () => {
    const menu = commands.find(command => command.name === "選單");
    const setup = commands.find(command => command.name === "設定");
    expect(menu?.options ?? []).toHaveLength(0);
    expect(JSON.stringify(setup)).not.toMatch(/setup|channels|role_channel|date|party|match_hub|moderation/);
  });

  it("頻道設定不再要求私人媒合區", () => {
    const setup = commands.find(command => command.name === "設定");
    const channels = setup?.options?.find(option => option.name === "頻道") as { options?: { name: string }[] } | undefined;
    expect(channels?.options?.map(option => option.name)).not.toContain("私人媒合");
  });
});
