import { InlineKeyboard } from "grammy";
import type { SubscriptionStatus } from "../../models/subscription.js";

export function subscriptionActionsKeyboard(
  subId: string,
  status?: SubscriptionStatus,
): InlineKeyboard {
  const statusButton =
    status === "paused"
      ? {
          ...InlineKeyboard.text("▶️ Resume", `sub:resume:${subId}`),
          style: "success" as const,
        }
      : InlineKeyboard.text("Pause", `sub:pause:${subId}`);

  return new InlineKeyboard()
    .text("View", `sub:view:${subId}`)
    .text("Edit", `sub:edit:${subId}`)
    .primary()
    .text("Delete", `sub:delete:${subId}`)
    .danger()
    .row()
    .add(statusButton);
}
