import type { InputRichMessage } from "grammy/types";
import type { BotContext } from "../../types/context.js";
import { createLogger } from "../../utils/logger.js";
import { helpActionsKeyboard } from "../ui/navigation.js";
import { sendRichOrPlain } from "../ui/richMessage.js";

const HELP_TEXT =
  "订阅管理助手\n\n" +
  "常用操作：\n" +
  "/add — 逐步添加订阅\n" +
  "/list — 管理、编辑、暂停或删除订阅\n" +
  "/report — 查看支出总览\n" +
  "/reminders — 查看近期扣款\n" +
  "/settings — 设置提醒、时区和报告币种\n" +
  "/menu — 恢复主菜单\n" +
  "/cancel — 取消当前操作\n\n" +
  "更多工具：\n" +
  "/list_text — 查看纯文本订阅清单\n" +
  "/report_text — 查看文字版支出明细\n" +
  "/export — 导出 JSON 数据文件\n" +
  "/delete_me — 永久删除全部数据\n\n" +
  "快捷添加：\n" +
  "/add <名称> <价格> <币种> <周期> <日期>\n" +
  "示例：/add Netflix 12.99 CNY monthly 2026-06-01\n" +
  "包含空格的名称、体验订阅或非自动续费，请使用交互式 /add。";

function helpRichMessage(): InputRichMessage {
  return {
    blocks: [
      { type: "heading", size: 1, text: "订阅管理助手" },
      {
        type: "paragraph",
        text: "记录周期性订阅、提醒下次扣款，并汇总每月支出。",
      },
      { type: "divider" },
      { type: "heading", size: 3, text: "快速开始" },
      {
        type: "list",
        items: [
          {
            blocks: [{ type: "paragraph", text: "/add — 逐步添加订阅" }],
          },
          {
            blocks: [
              {
                type: "paragraph",
                text: "/list — 管理、编辑、暂停或删除订阅",
              },
            ],
          },
          {
            blocks: [{ type: "paragraph", text: "/report — 查看支出总览" }],
          },
          {
            blocks: [{ type: "paragraph", text: "/reminders — 查看近期扣款" }],
          },
          {
            blocks: [{ type: "paragraph", text: "/settings — 提醒与报告设置" }],
          },
        ],
      },
      {
        type: "details",
        summary: "更多命令",
        blocks: [
          {
            type: "paragraph",
            text:
              "/menu 恢复主菜单\n" +
              "/cancel 取消当前操作\n" +
              "/list_text 纯文本清单\n" +
              "/report_text 文字报告",
          },
        ],
      },
      {
        type: "details",
        summary: "隐私与数据",
        blocks: [
          {
            type: "paragraph",
            text:
              "/export 导出 JSON 数据文件\n" +
              "/delete_me 永久删除全部数据（需要再次确认）",
          },
        ],
      },
      {
        type: "details",
        summary: "一行快捷添加",
        blocks: [
          {
            type: "pre",
            language: "text",
            text: "/add Netflix 12.99 CNY monthly 2026-06-01",
          },
          {
            type: "paragraph",
            text: "名称包含空格、体验订阅或非自动续费时，请使用交互式 /add。",
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
