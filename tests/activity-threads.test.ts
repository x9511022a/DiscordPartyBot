import { ThreadAutoArchiveDuration } from "discord.js";
import { describe, expect, it } from "vitest";
import { ACTIVITY_THREAD_AUTO_ARCHIVE } from "../src/services/activity-threads.js";

describe("活動私人討論串政策", () => {
  it("使用 24 小時無活動自動封存", () => {
    expect(ACTIVITY_THREAD_AUTO_ARCHIVE).toBe(ThreadAutoArchiveDuration.OneDay);
  });
});
