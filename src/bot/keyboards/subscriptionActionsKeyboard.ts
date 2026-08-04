import { InlineKeyboard } from "grammy";
import type { SubscriptionStatus } from "../../models/subscription.js";

export function subscriptionActionsKeyboard(
  subId: string,
  status?: SubscriptionStatus,
): InlineKeyboard {
  const statusButton =
    status === "paused"
      ? {
          ...InlineKeyboard.text("▶️ 恢复", `sub:resume:${subId}`),
          style: "success" as const,
        }
      : InlineKeyboard.text("暂停", `sub:pause:${subId}`);

  return new InlineKeyboard()
    .text("查看", `sub:view:${subId}`)
    .text("编辑", `sub:edit:${subId}`)
    .primary()
    .text("删除", `sub:delete:${subId}`)
    .danger()
    .row()
    .add(statusButton);
}
