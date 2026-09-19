import { describe, expect, it } from "vitest";
import {
  MAIN_MENU_BUTTON_LABELS,
  actionFromMainMenuText,
  mainMenuReplyKeyboard,
} from "../src/bot/keyboards/mainMenuKeyboard.js";

describe("main menu keyboard", () => {
  it("builds a persistent reply keyboard", () => {
    const keyboard = mainMenuReplyKeyboard();

    expect(keyboard.keyboard[0][0].text).toBe(MAIN_MENU_BUTTON_LABELS.add);
    expect(keyboard.resize_keyboard).toBe(true);
    expect(keyboard.is_persistent).toBe(true);
  });

  it("parses callback data and reply keyboard text", () => {
    expect(actionFromMainMenuText(MAIN_MENU_BUTTON_LABELS.report)).toBe(
      "report",
    );
    expect(actionFromMainMenuText("Random input")).toBeNull();
  });
});
