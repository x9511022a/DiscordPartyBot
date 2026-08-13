export const activityStatusLabels: Record<string, string> = {
  OPEN: "開放中", MATCHING: "媒合處理中", MATCHED: "已媒合", CLOSED: "已關閉",
  CANCELLED: "已取消", ENDED: "已結束"
};

export const applicationStatusLabels: Record<string, string> = {
  PENDING: "等待回覆", MATCHING: "接受處理中", ACCEPTED: "已接受",
  DECLINED: "未接受", WITHDRAWN: "已撤回", CANCELLED: "已取消"
};

export const attendanceStatusLabels: Record<string, string> = {
  GOING: "正式參加", WAITLISTED: "候補中", LEFT: "已退出", CANCELLED: "已取消"
};

export const moderationActionLabels: Record<string, string> = {
  WARN: "警告", SUSPEND: "暫停使用", BAN: "封禁", UNSUSPEND: "解除暫停",
  UNBAN: "解除封禁", REMOVE_CONTENT: "下架內容"
};
