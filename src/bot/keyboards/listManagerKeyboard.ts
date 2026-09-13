import { InlineKeyboard } from "grammy";
import type { Subscription } from "../../models/subscription.js";
import {
  isAutoRenewing,
  isTrialSubscription,
} from "../../utils/subscriptionFlags.js";
import { editableFieldsKeyboard } from "./editFields.js";

export const LIST_PAGE_SIZE = 12;

export function getTotalPages(subs: Subscription[]): number {
  return Math.max(1, Math.ceil(subs.length / LIST_PAGE_SIZE));
}

export function buildListPageKeyboard(
  subs: Subscription[],
  page: number,
): InlineKeyboard {
  const start = page * LIST_PAGE_SIZE;
  const pageSubs = subs.slice(start, start + LIST_PAGE_SIZE);
  const kb = new InlineKeyboard();

  for (let i = 0; i < pageSubs.length; i++) {
    kb.text(String(start + i + 1), `list:select:${pageSubs[i].id}:${page}`);
    if (i % 6 === 5) kb.row();
  }
  if (pageSubs.length % 6 !== 0) kb.row();
  const tp = getTotalPages(subs);
  if (tp > 1) {
    if (page > 0) {
      kb.text("⬅️ 上一页", `list:page:${page - 1}`);
    }
    if (page < tp - 1) {
      kb.text("➡️ 下一页", `list:page:${page + 1}`);
    }
  }

  return kb;
}

export function buildDetailKeyboard(
  sub: Subscription,
  page: number,
): InlineKeyboard {
  const statusButton =
    sub.status === "paused"
      ? InlineKeyboard.text("▶️ 恢复", `list:resume:${sub.id}:${page}`)
      : InlineKeyboard.text("⏸ 暂停", `list:pause:${sub.id}:${page}`);
  const trialLabel = isTrialSubscription(sub) ? "取消体验" : "标记体验";
  const autoRenewLabel = isAutoRenewing(sub) ? "关闭自动续费" : "开启自动续费";

  return new InlineKeyboard()
    .text("✏️ 编辑", `list:edit:${sub.id}:${page}`)
    .text("🗑 删除", `list:del:${sub.id}:${page}`)
    .row()
    .add(statusButton)
    .text(trialLabel, `list:ef:trial:${sub.id}:${page}`)
    .row()
    .text(autoRenewLabel, `list:ef:autorenew:${sub.id}:${page}`)
    .text("← 返回列表", `list:back:${page}`);
}

export function buildEditFieldKeyboard(
  subId: string,
  page: number,
): InlineKeyboard {
  return editableFieldsKeyboard({
    callbackData: (field) => `list:ef:${field}:${subId}:${page}`,
    backButton: {
      label: "← 返回详情",
      callbackData: `list:detail:${subId}:${page}`,
    },
  });
}

export function buildDeleteConfirmKeyboard(
  subId: string,
  page: number,
): InlineKeyboard {
  return new InlineKeyboard()
    .text("🗑 确认删除", `list:delok:${subId}:${page}`)
    .danger()
    .text("❌ 取消", `list:delno:${subId}:${page}`);
}
