import { describe, expect, it } from "vitest";
import { activityStatusLabels, attendanceStatusLabels, moderationActionLabels } from "../src/ui/labels.js";

describe("狀態繁體中文映射", () => {
  it("涵蓋活動、報名與管理處置狀態", () => {
    expect(activityStatusLabels.OPEN).toBe("開放中");
    expect(attendanceStatusLabels.WAITLISTED).toBe("候補中");
    expect(moderationActionLabels.REMOVE_CONTENT).toBe("下架內容");
  });
});
