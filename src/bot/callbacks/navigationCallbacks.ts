import type { BotContext } from "../../types/context.js";
import { addCommand } from "../commands/add.js";
import { exportCommand } from "../commands/export.js";
import { helpCommand } from "../commands/help.js";
import { listCommand, listTextCommand } from "../commands/list.js";
import { menuCommand } from "../commands/menu.js";
import { remindersCommand } from "../commands/reminders.js";
import { reportCommand } from "../commands/report.js";
import { reportTextCommand } from "../commands/reportText.js";
import { settingsCommand } from "../commands/settings.js";
import { withMessageText } from "../mainMenuActions.js";
import { parseNavigationCallbackData } from "../ui/navigation.js";

export async function navigationCallback(ctx: BotContext): Promise<void> {
  const action = parseNavigationCallbackData(ctx.callbackQuery?.data);
  if (!action) {
    await ctx.answerCallbackQuery("按钮数据无效。");
    return;
  }

  await ctx.answerCallbackQuery();

  switch (action) {
    case "menu":
      await menuCommand(ctx);
      return;
    case "add":
      await addCommand(withMessageText(ctx, "/add"));
      return;
    case "list":
      await listCommand(ctx);
      return;
    case "list_text":
      await listTextCommand(ctx);
      return;
    case "report":
      await reportCommand(ctx);
      return;
    case "report_text":
      await reportTextCommand(ctx);
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
    case "export":
      await exportCommand(ctx);
      return;
  }
}
