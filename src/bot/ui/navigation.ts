import { InlineKeyboard } from "grammy";

export const NAVIGATION_ACTIONS = [
  "menu",
  "add",
  "list",
  "list_text",
  "report",
  "report_text",
  "reminders",
  "settings",
  "help",
  "export",
] as const;

export type NavigationAction = (typeof NAVIGATION_ACTIONS)[number];

export function parseNavigationCallbackData(
  data: string | undefined,
): NavigationAction | null {
  if (!data?.startsWith("nav:")) return null;
  const action = data.slice(4);
  return NAVIGATION_ACTIONS.includes(action as NavigationAction)
    ? (action as NavigationAction)
    : null;
}

export function emptySubscriptionsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("➕ 添加订阅", "nav:add")
    .primary()
    .row()
    .text("🏠 返回菜单", "nav:menu");
}

export function emptyRemindersKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📋 管理订阅", "nav:list")
    .primary()
    .text("⚙️ 提醒设置", "nav:settings");
}

export function postAddKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📋 管理订阅", "nav:list")
    .primary()
    .text("➕ 再添加一个", "nav:add")
    .row()
    .text("📊 查看报告", "nav:report");
}

export function reportActionsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📄 文字明细", "nav:report_text")
    .primary()
    .text("⚙️ 报告设置", "nav:settings");
}

export function helpActionsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("➕ 添加订阅", "nav:add")
    .primary()
    .text("📋 管理订阅", "nav:list")
    .row()
    .text("📊 支出报告", "nav:report")
    .text("⚙️ 设置", "nav:settings");
}

export function privacyActionsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📦 导出数据", "settings:export")
    .primary()
    .row()
    .text("🗑 永久删除数据", "settings:delete")
    .danger()
    .row()
    .text("← 返回设置", "settings:back");
}

export function expiredPanelKeyboard(
  restart: "add" | "list" | "settings",
): InlineKeyboard {
  return new InlineKeyboard()
    .text("重新开始", `nav:${restart}`)
    .primary()
    .text("🏠 返回菜单", "nav:menu");
}
