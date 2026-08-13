import { AttendanceStatus, ModerationActionType } from "@prisma/client";

export function assertConsent(consented: boolean): void {
  if (!consented) throw new Error("請先使用 /開始使用，確認年滿 18 歲並同意規範。");
}

export function assertModerationEligibility(action: ModerationActionType | null, expiresAt: Date | null, now = new Date()): void {
  if (action === ModerationActionType.BAN) throw new Error("你已被禁止使用此機器人。");
  if (action === ModerationActionType.SUSPEND && (!expiresAt || expiresAt > now)) throw new Error("你的使用資格目前已被暫停。");
}

export function nextPartyStatus(going: number, capacity: number): AttendanceStatus {
  return going < capacity ? AttendanceStatus.GOING : AttendanceStatus.WAITLISTED;
}

export function canReserveDate(postStatus: string, applicationStatus: string): boolean {
  return postStatus === "OPEN" && applicationStatus === "PENDING";
}
