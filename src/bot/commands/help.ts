import type { InputRichMessage } from "grammy/types";
import type { BotContext } from "../../types/context.js";
import { createLogger } from "../../utils/logger.js";
import { helpActionsKeyboard } from "../ui/navigation.js";
import { sendRichOrPlain } from "../ui/richMessage.js";

const HELP_TEXT =
  "Subscription Manager\n\n" +
  "Track subscriptions, review reminders and spending, and manage your settings.\n\n" +
  "/menu — Restore main menu\n" +
  "/cancel — Cancel the current operation\n\n" +
  "More tools: \n" +
  "/list_text — View subscriptions as plain text\n" +
  "/report_text — View spending details as text\n" +
  "/export — Export JSON data file\n" +
  "/delete_me — Permanently delete all data\n\n" +
  "Quick add: \n" +
  "/add <Name> <Price> <Currency> <Cycle> <Date>\n" +
  "Example: /add Netflix 12.99 CNY monthly 2026-06-01\n" +
  "Use interactive /add for names containing spaces, trials, or subscriptions without automatic renewal.";

function helpRichMessage(): InputRichMessage {
  return {
    blocks: [
      { type: "heading", size: 1, text: "Subscription Manager" },
      {
        type: "paragraph",
        text: "Track recurring subscriptions, get payment reminders, and review monthly spending.",
      },
      {
        type: "details",
        summary: "More commands",
        blocks: [
          {
            type: "paragraph",
            text:
              "/menu Restore main menu\n" +
              "/cancel Cancel the current operation\n" +
              "/list_text Plain-text list\n" +
              "/report_text Text report",
          },
        ],
      },
      {
        type: "details",
        summary: "Privacy and data",
        blocks: [
          {
            type: "paragraph",
            text:
              "/export Export JSON data file\n" +
              "/delete_me Permanently delete all data (confirmation required)",
          },
        ],
      },
      {
        type: "details",
        summary: "Quick add in one line",
        blocks: [
          {
            type: "pre",
            language: "text",
            text: "/add Netflix 12.99 CNY monthly 2026-06-01",
          },
          {
            type: "paragraph",
            text: "Use interactive /add for names containing spaces, trials, or subscriptions without automatic renewal.",
          },
        ],
      },
    ],
  };
}

export async function helpCommand(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);
  const result = await sendRichOrPlain(ctx, {
    richMessage: helpRichMessage(),
    plainText: HELP_TEXT,
    replyMarkup: helpActionsKeyboard(),
  });

  if (result.fallbackErrorType) {
    logger.warn("Rich help unavailable; sent plain fallback", {
      errorType: result.fallbackErrorType,
    });
  }
}
