import { Keyboard } from "grammy";

export const MAIN_MENU_ACTIONS = [
  "add",
  "list",
  "report",
  "reminders",
  "settings",
  "help",
] as const;

export type MainMenuAction = (typeof MAIN_MENU_ACTIONS)[number];

export const MAIN_MENU_BUTTON_LABELS: Record<MainMenuAction, string> = {
  add: "➕ 添加订阅",
  list: "📋 管理订阅",
  report: "📊 支出报告",
  reminders: "⏰ 近期扣款",
  settings: "⚙️ 设置",
  help: "❓ 帮助",
};

export function actionFromMainMenuText(
  text: string | undefined,
): MainMenuAction | null {
  if (!text) return null;
  const entry = MAIN_MENU_ACTIONS.find(
    (action) => MAIN_MENU_BUTTON_LABELS[action] === text,
  );
  return entry ?? null;
}

export function mainMenuReplyKeyboard(): Keyboard {
  return new Keyboard()
    .text(MAIN_MENU_BUTTON_LABELS.add)
    .primary()
    .text(MAIN_MENU_BUTTON_LABELS.list)
    .primary()
    .row()
    .text(MAIN_MENU_BUTTON_LABELS.report)
    .text(MAIN_MENU_BUTTON_LABELS.reminders)
    .row()
    .text(MAIN_MENU_BUTTON_LABELS.settings)
    .text(MAIN_MENU_BUTTON_LABELS.help)
    .resized()
    .persistent();
}
