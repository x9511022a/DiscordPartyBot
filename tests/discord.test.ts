import { describe, expect, it, vi } from "vitest";
import { resolveGuild } from "../src/utils/discord.js";

describe("伺服器互動解析", () => {
  it("有 guildId 時不要求 Guild 必須已在快取", async () => {
    const fetchedGuild = { id: "guild-1" };
    const fetch = vi.fn().mockResolvedValue(fetchedGuild);
    const interaction = {
      guildId: "guild-1",
      guild: null,
      client: { guilds: { fetch } }
    };

    await expect(resolveGuild(interaction as never)).resolves.toBe(fetchedGuild);
    expect(fetch).toHaveBeenCalledWith("guild-1");
  });

  it("私訊互動仍會被拒絕", async () => {
    const interaction = { guildId: null, guild: null, client: { guilds: { fetch: vi.fn() } } };
    await expect(resolveGuild(interaction as never)).rejects.toThrow("只能在伺服器");
  });
});
