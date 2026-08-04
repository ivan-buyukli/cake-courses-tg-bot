import { InlineKeyboard } from "grammy";

export function privacyDeleteKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🗑 删除全部数据", "privacy:delete_confirm")
    .danger()
    .text("❌ 取消", "privacy:delete_cancel");
}
