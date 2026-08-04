import type { BotContext } from "../types/context.js";
import { addCommand } from "./commands/add.js";
import { helpCommand } from "./commands/help.js";
import { listCommand } from "./commands/list.js";
import { remindersCommand } from "./commands/reminders.js";
import { reportCommand } from "./commands/report.js";
import { settingsCommand } from "./commands/settings.js";
import {
  actionFromMainMenuText,
  type MainMenuAction,
} from "./keyboards/mainMenuKeyboard.js";

export async function dispatchMainMenuAction(
  ctx: BotContext,
  action: MainMenuAction,
): Promise<void> {
  switch (action) {
    case "add":
      await addCommand(withMessageText(ctx, "/add"));
      return;
    case "list":
      await listCommand(ctx);
      return;
    case "report":
      await reportCommand(ctx);
      return;
    case "reminders":
      await remindersCommand(ctx);
      return;
    case "settings":
      await settingsCommand(ctx);
      return;
    case "help":
      await helpCommand(ctx);
      return;
  }
}

export function withMessageText(ctx: BotContext, text: string): BotContext {
  const commandCtx = Object.create(ctx) as BotContext;
  Object.defineProperty(commandCtx, "msg", {
    value: { ...ctx.msg, text },
  });
  return commandCtx;
}

export async function mainMenuText(ctx: BotContext): Promise<void> {
  const action = actionFromMainMenuText(ctx.msg?.text);
  if (!action) return;
  await dispatchMainMenuAction(ctx, action);
}
