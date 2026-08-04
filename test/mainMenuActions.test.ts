import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotContext } from "../src/types/context.js";
import { MAIN_MENU_BUTTON_LABELS } from "../src/bot/keyboards/mainMenuKeyboard.js";

vi.mock("../src/bot/commands/add.js", () => ({
  addCommand: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../src/bot/commands/help.js", () => ({
  helpCommand: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../src/bot/commands/list.js", () => ({
  listCommand: vi.fn().mockResolvedValue(undefined),
  listFullCommand: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../src/bot/commands/reminders.js", () => ({
  remindersCommand: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../src/bot/commands/report.js", () => ({
  reportCommand: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../src/bot/commands/settings.js", () => ({
  settingsCommand: vi.fn().mockResolvedValue(undefined),
}));

import { addCommand } from "../src/bot/commands/add.js";
import { helpCommand } from "../src/bot/commands/help.js";
import { listCommand, listFullCommand } from "../src/bot/commands/list.js";
import { remindersCommand } from "../src/bot/commands/reminders.js";
import { reportCommand } from "../src/bot/commands/report.js";
import { settingsCommand } from "../src/bot/commands/settings.js";
import {
  dispatchMainMenuAction,
  mainMenuText,
} from "../src/bot/mainMenuActions.js";

function createContext(text?: string): BotContext {
  return {
    msg: text ? { text } : undefined,
    conversation: {
      enter: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as BotContext;
}

describe("main menu actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches each main menu action to its command", async () => {
    const ctx = createContext();

    await dispatchMainMenuAction(ctx, "add");
    await dispatchMainMenuAction(ctx, "list");
    await dispatchMainMenuAction(ctx, "report");
    await dispatchMainMenuAction(ctx, "reminders");
    await dispatchMainMenuAction(ctx, "settings");
    await dispatchMainMenuAction(ctx, "help");

    expect(addCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.objectContaining({ text: "/add" }),
      }),
    );
    expect(listCommand).toHaveBeenCalledWith(ctx);
    expect(reportCommand).toHaveBeenCalledWith(ctx);
    expect(remindersCommand).toHaveBeenCalledWith(ctx);
    expect(settingsCommand).toHaveBeenCalledWith(ctx);
    expect(helpCommand).toHaveBeenCalledWith(ctx);
  });

  it("dispatches recognized reply keyboard text", async () => {
    const ctx = createContext(MAIN_MENU_BUTTON_LABELS.reminders);

    await mainMenuText(ctx);

    expect(remindersCommand).toHaveBeenCalledWith(ctx);
  });

  it("ignores unrelated text", async () => {
    const unrelatedCtx = createContext("hello");
    const emptyCtx = createContext();

    await mainMenuText(unrelatedCtx);
    await mainMenuText(emptyCtx);

    expect(addCommand).not.toHaveBeenCalled();
    expect(helpCommand).not.toHaveBeenCalled();
    expect(listCommand).not.toHaveBeenCalled();
    expect(listFullCommand).not.toHaveBeenCalled();
    expect(remindersCommand).not.toHaveBeenCalled();
    expect(reportCommand).not.toHaveBeenCalled();
    expect(settingsCommand).not.toHaveBeenCalled();
  });
});
