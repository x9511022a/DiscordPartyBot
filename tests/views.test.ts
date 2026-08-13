import { ActivityStatus, type DatePost, type Party } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { dateMessage, partyMessage } from "../src/views.js";

const base = { createdAt: new Date("2026-08-12T00:00:00Z"), updatedAt: new Date("2026-08-12T00:00:00Z"), closedAt: null };

describe("公開貼文隱私", () => {
  it("約會公開訊息不包含詳細地址", () => {
    const post: DatePost = { ...base, id: "date1", guildId: "g", creatorId: "u", channelId: null, messageId: null, threadId: null, scheduledAt: new Date("2026-09-01T00:00:00Z"), publicArea: "台北市", privateLocation: "秘密地址 123 號", activity: "晚餐", cost: "AA", desiredPerson: "健談", notes: null, status: ActivityStatus.OPEN, matchedUserId: null, matchingAppId: null };
    expect(JSON.stringify(dateMessage(post))).not.toContain(post.privateLocation);
  });

  it("Party 公開訊息不包含詳細地址", () => {
    const party: Party = { ...base, id: "party1", guildId: "g", creatorId: "u", channelId: null, messageId: null, threadId: null, visibilityRoleId: null, name: "桌遊夜", scheduledAt: new Date("2026-09-01T00:00:00Z"), signupDeadline: new Date("2026-08-31T00:00:00Z"), publicArea: "信義區", privateLocation: "秘密包廂", description: "一起玩", capacity: 5, status: ActivityStatus.OPEN };
    expect(JSON.stringify(partyMessage(party, 3, 1))).not.toContain(party.privateLocation);
  });
});
