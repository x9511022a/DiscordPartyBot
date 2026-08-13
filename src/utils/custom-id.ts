export type ComponentAction =
  | "date_apply"
  | "date_accept"
  | "date_decline"
  | "date_cancel"
  | "date_manage"
  | "party_join"
  | "party_leave"
  | "party_cancel"
  | "party_manage";

export function customId(action: ComponentAction, id: string): string {
  return `${action}:${id}`;
}

export function parseCustomId(value: string): { action: ComponentAction; id: string } | null {
  const [action, id, extra] = value.split(":");
  if (!action || !id || extra) return null;
  const allowed: ComponentAction[] = ["date_apply", "date_accept", "date_decline", "date_cancel", "date_manage", "party_join", "party_leave", "party_cancel", "party_manage"];
  return allowed.includes(action as ComponentAction) ? { action: action as ComponentAction, id } : null;
}
