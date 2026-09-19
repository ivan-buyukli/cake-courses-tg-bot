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
    .text("➕ Add subscription", "nav:add")
    .primary()
    .row()
    .text("🏠 Back to menu", "nav:menu");
}

export function emptyRemindersKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📋 Manage subscriptions", "nav:list")
    .primary()
    .text("⚙️ Reminder settings", "nav:settings");
}

export function postAddKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📋 Manage subscriptions", "nav:list")
    .primary()
    .text("➕ Add another", "nav:add")
    .row()
    .text("📊 View report", "nav:report");
}

export function reportActionsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📄 Text details", "nav:report_text")
    .primary()
    .text("⚙️ Report settings", "nav:settings");
}

export function helpActionsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("➕ Add subscription", "nav:add")
    .primary()
    .text("📋 Manage subscriptions", "nav:list")
    .row()
    .text("📊 Spending report", "nav:report")
    .text("⚙️ Settings", "nav:settings");
}

export function privacyActionsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📦 Export data", "settings:export")
    .primary()
    .row()
    .text("🗑 Permanently delete data", "settings:delete")
    .danger()
    .row()
    .text("← Back to settings", "settings:back");
}

export function expiredPanelKeyboard(
  restart: "add" | "list" | "settings",
): InlineKeyboard {
  return new InlineKeyboard()
    .text("Start again", `nav:${restart}`)
    .primary()
    .text("🏠 Back to menu", "nav:menu");
}
