import { describe, it, expect } from "vitest";
import {
  settingsKeyboard,
  settingsPresentation,
  hourPickerKeyboard,
  timezoneKeyboard,
  timezoneOffsetKeyboard,
} from "../../../src/bot/conversations/settingsConversation.js";
import { parseSettingsCallbackData } from "../../../src/utils/callbackParser.js";
import { userSettingsSchema } from "../../../src/schemas/userSettingsSchema.js";
import {
  UserSettings,
  DEFAULT_USER_SETTINGS,
  SUPPORTED_TIMEZONES,
  isValidUtcOffset,
  normalizeUtcOffset,
} from "../../../src/models/userSettings.js";

describe("settingsConversation", () => {
  describe("settingsKeyboard", () => {
    it("renders all setting options", () => {
      const kb = settingsKeyboard(DEFAULT_USER_SETTINGS);
      const buttons = kb.inline_keyboard.flat();
      const texts = buttons.map((b) => b.text);

      expect(texts.some((t) => t.includes("Report currency"))).toBe(true);
      expect(texts.some((t) => t.includes("Reminder"))).toBe(true);
      expect(texts.some((t) => t.includes("time"))).toBe(true);
      expect(texts.some((t) => t.includes("Timezone"))).toBe(true);
      expect(texts).toContain("Done");
    });

    it("offers disabling when reminders are enabled", () => {
      const settings: UserSettings = {
        ...DEFAULT_USER_SETTINGS,
        reminderEnabled: true,
      };
      const kb = settingsKeyboard(settings);
      const buttons = kb.inline_keyboard.flat();
      const reminderBtn = buttons.find(
        (b) =>
          "callback_data" in b &&
          b.callback_data === "settings:toggle_reminder",
      );
      expect(reminderBtn?.text).toBe("Disable reminders");
    });

    it("offers enabling when reminders are disabled", () => {
      const settings: UserSettings = {
        ...DEFAULT_USER_SETTINGS,
        reminderEnabled: false,
      };
      const kb = settingsKeyboard(settings);
      const buttons = kb.inline_keyboard.flat();
      const reminderBtn = buttons.find(
        (b) =>
          "callback_data" in b &&
          b.callback_data === "settings:toggle_reminder",
      );
      expect(reminderBtn?.text).toBe("Enable reminders");
    });

    it("shows current hour in HH:00 format", () => {
      const settings: UserSettings = {
        ...DEFAULT_USER_SETTINGS,
        reminderHour: 9,
      };
      const kb = settingsKeyboard(settings);
      const buttons = kb.inline_keyboard.flat();
      const timeBtn = buttons.find((b) => b.text.includes("time"));
      expect(timeBtn?.text).toBe("Reminder time");
      expect(settingsPresentation(settings).plainText).toContain("09:00");
    });

    it("shows current currency and timezone", () => {
      const settings: UserSettings = {
        ...DEFAULT_USER_SETTINGS,
        defaultCurrency: "CNY",
        timezone: "Asia/Shanghai",
      };
      const kb = settingsKeyboard(settings);
      const buttons = kb.inline_keyboard.flat();
      const texts = buttons.map((b) => b.text);

      expect(texts).not.toContain("CNY");
      expect(settingsPresentation(settings).plainText).toContain("CNY");
      expect(settingsPresentation(settings).plainText).toContain(
        "Asia/Shanghai",
      );
    });
  });

  describe("hourPickerKeyboard", () => {
    it("renders all 24 hours", () => {
      const kb = hourPickerKeyboard();
      const buttons = kb.inline_keyboard.flat();
      const hourButtons = buttons.filter(
        (b) => /^\d{2}$/.test(b.text) || /^\* \d{2}$/.test(b.text),
      );
      expect(hourButtons.length).toBe(24);
    });

    it("marks current hour with asterisk", () => {
      const kb = hourPickerKeyboard(9);
      const buttons = kb.inline_keyboard.flat();
      const marked = buttons.find((b) => b.text === "* 09");
      expect(marked).toBeDefined();
    });

    it("has a back button", () => {
      const kb = hourPickerKeyboard();
      const buttons = kb.inline_keyboard.flat();
      const backBtn = buttons.find((b) => b.text === "Back");
      expect(backBtn).toBeDefined();
    });
  });

  describe("timezoneKeyboard", () => {
    it("renders all supported timezones", () => {
      const kb = timezoneKeyboard();
      const buttons = kb.inline_keyboard.flat();
      const tzButtons = buttons.filter((b) =>
        SUPPORTED_TIMEZONES.some(
          (tz) => b.text === tz.label || b.text === `* ${tz.label}`,
        ),
      );
      expect(tzButtons.length).toBe(SUPPORTED_TIMEZONES.length);
    });

    it("marks current timezone with asterisk", () => {
      const kb = timezoneKeyboard("Asia/Shanghai");
      const buttons = kb.inline_keyboard.flat();
      const marked = buttons.find((b) => b.text === "* China (Shanghai)");
      expect(marked).toBeDefined();
    });

    it("has a back button", () => {
      const kb = timezoneKeyboard();
      const buttons = kb.inline_keyboard.flat();
      const backBtn = buttons.find((b) => b.text === "Back");
      expect(backBtn).toBeDefined();
    });

    it("has a custom offset button", () => {
      const kb = timezoneKeyboard();
      const buttons = kb.inline_keyboard.flat();
      const customBtn = buttons.find(
        (b) => b.text === "Custom timezone offset",
      );
      expect(customBtn).toBeDefined();
      expect(customBtn?.callback_data).toBe("settings:tzoffset");
    });
  });

  describe("timezoneOffsetKeyboard", () => {
    it("renders offset presets without duplicating first-page timezone labels", () => {
      const kb = timezoneOffsetKeyboard();
      const buttons = kb.inline_keyboard.flat();
      const texts = buttons.map((b) => b.text);
      const firstPageLabels = SUPPORTED_TIMEZONES.map((tz) => tz.label);

      expect(texts).toEqual(
        expect.arrayContaining([
          "UTC+5:30",
          "UTC+5:45",
          "UTC+9:30",
          "UTC+10",
          "UTC-3",
          "Other",
          "Back",
        ]),
      );
      expect(texts.some((text) => firstPageLabels.includes(text))).toBe(false);
    });
  });

  describe("isValidUtcOffset", () => {
    it("accepts valid UTC+X:XX format", () => {
      expect(isValidUtcOffset("UTC+08:00")).toBe(true);
      expect(isValidUtcOffset("UTC-05:00")).toBe(true);
      expect(isValidUtcOffset("UTC+05:30")).toBe(true);
      expect(isValidUtcOffset("UTC-03:30")).toBe(true);
      expect(isValidUtcOffset("UTC+05:45")).toBe(true);
    });

    it("accepts UTC+00:00", () => {
      expect(isValidUtcOffset("UTC+00:00")).toBe(true);
      expect(isValidUtcOffset("UTC-00:00")).toBe(true);
    });

    it("accepts UTC+14:00 (max)", () => {
      expect(isValidUtcOffset("UTC+14:00")).toBe(true);
    });

    it("rejects UTC+14:01 (over max)", () => {
      expect(isValidUtcOffset("UTC+14:01")).toBe(false);
    });

    it("rejects hour > 14", () => {
      expect(isValidUtcOffset("UTC+15:00")).toBe(false);
    });

    it("rejects non-standard minutes", () => {
      expect(isValidUtcOffset("UTC+05:05")).toBe(false);
      expect(isValidUtcOffset("UTC+05:59")).toBe(false);
    });

    it("rejects non-UTC format", () => {
      expect(isValidUtcOffset("GMT+08:00")).toBe(false);
      expect(isValidUtcOffset("+08:00")).toBe(false);
    });
  });

  describe("normalizeUtcOffset", () => {
    it("normalizes +8 to UTC+08:00", () => {
      expect(normalizeUtcOffset("+8")).toBe("UTC+08:00");
    });

    it("normalizes -5 to UTC-05:00", () => {
      expect(normalizeUtcOffset("-5")).toBe("UTC-05:00");
    });

    it("normalizes +5:30 to UTC+05:30", () => {
      expect(normalizeUtcOffset("+5:30")).toBe("UTC+05:30");
    });

    it("normalizes -3:30 to UTC-03:30", () => {
      expect(normalizeUtcOffset("-3:30")).toBe("UTC-03:30");
    });

    it("normalizes +5.5 to UTC+05:30", () => {
      expect(normalizeUtcOffset("+5.5")).toBe("UTC+05:30");
    });

    it("normalizes -3.5 to UTC-03:30", () => {
      expect(normalizeUtcOffset("-3.5")).toBe("UTC-03:30");
    });

    it("normalizes UTC+08:00 as-is", () => {
      expect(normalizeUtcOffset("UTC+08:00")).toBe("UTC+08:00");
    });

    it("normalizes UTC-05:30 as-is", () => {
      expect(normalizeUtcOffset("UTC-05:30")).toBe("UTC-05:30");
    });

    it("handles extra spaces: + 8", () => {
      expect(normalizeUtcOffset("+ 8")).toBe("UTC+08:00");
    });

    it("handles lowercase UTC prefix", () => {
      expect(normalizeUtcOffset("utc+8")).toBe("UTC+08:00");
    });

    it("normalizes bare +5:45 to UTC+05:45", () => {
      expect(normalizeUtcOffset("+5:45")).toBe("UTC+05:45");
    });

    it("normalizes decimal +5.25 to UTC+05:15", () => {
      expect(normalizeUtcOffset("+5.25")).toBe("UTC+05:15");
    });

    it("normalizes decimal +5.75 to UTC+05:45", () => {
      expect(normalizeUtcOffset("+5.75")).toBe("UTC+05:45");
    });

    it("returns null for invalid input", () => {
      expect(normalizeUtcOffset("abc")).toBeNull();
      expect(normalizeUtcOffset("++5")).toBeNull();
      expect(normalizeUtcOffset("5")).toBeNull();
      expect(normalizeUtcOffset("+15")).toBeNull();
    });
  });

  describe("parseSettingsCallbackData", () => {
    it("parses toggle_reminder", () => {
      const result = parseSettingsCallbackData("settings:toggle_reminder");
      expect(result).toEqual({ action: "toggle_reminder" });
    });

    it("parses hour action", () => {
      const result = parseSettingsCallbackData("settings:hour");
      expect(result).toEqual({ action: "hour" });
    });

    it("parses timezone action", () => {
      const result = parseSettingsCallbackData("settings:timezone");
      expect(result).toEqual({ action: "timezone" });
    });

    it("parses done action", () => {
      const result = parseSettingsCallbackData("settings:done");
      expect(result).toEqual({ action: "done" });
    });

    it("parses select_hour with valid hour", () => {
      const result = parseSettingsCallbackData("settings:hour:9");
      expect(result).toEqual({ action: "select_hour", hour: 9 });
    });

    it("parses select_hour with 0", () => {
      const result = parseSettingsCallbackData("settings:hour:0");
      expect(result).toEqual({ action: "select_hour", hour: 0 });
    });

    it("parses select_hour with 23", () => {
      const result = parseSettingsCallbackData("settings:hour:23");
      expect(result).toEqual({ action: "select_hour", hour: 23 });
    });

    it("returns null for select_hour with invalid hour", () => {
      expect(parseSettingsCallbackData("settings:hour:24")).toBeNull();
      expect(parseSettingsCallbackData("settings:hour:-1")).toBeNull();
      expect(parseSettingsCallbackData("settings:hour:abc")).toBeNull();
    });

    it("parses select_timezone", () => {
      const result = parseSettingsCallbackData("settings:tz:Asia/Shanghai");
      expect(result).toEqual({
        action: "select_timezone",
        timezone: "Asia/Shanghai",
      });
    });

    it("parses select_timezone with Europe/Berlin", () => {
      const result = parseSettingsCallbackData("settings:tz:Europe/Berlin");
      expect(result).toEqual({
        action: "select_timezone",
        timezone: "Europe/Berlin",
      });
    });

    it("parses timezone offset menu", () => {
      const result = parseSettingsCallbackData("settings:tzoffset");
      expect(result).toEqual({ action: "timezone_offset_menu" });
    });

    it("parses timezone offset preset", () => {
      const result = parseSettingsCallbackData("settings:tzoffset:+5:30");
      expect(result).toEqual({
        action: "timezone_offset",
        offset: "+5:30",
      });
    });

    it("parses timezone offset other", () => {
      const result = parseSettingsCallbackData("settings:tzoffset:other");
      expect(result).toEqual({ action: "timezone_offset_other" });
    });

    it("parses timezone offset back", () => {
      const result = parseSettingsCallbackData("settings:tzoffset:back");
      expect(result).toEqual({ action: "timezone_offset_back" });
    });

    it("returns null for unknown action", () => {
      expect(parseSettingsCallbackData("settings:unknown")).toBeNull();
    });

    it("returns null for wrong prefix", () => {
      expect(parseSettingsCallbackData("other:toggle_reminder")).toBeNull();
    });

    it("returns null for empty value", () => {
      expect(parseSettingsCallbackData("settings:tz:")).toBeNull();
      expect(parseSettingsCallbackData("settings:hour:")).toBeNull();
    });
  });

  describe("userSettingsSchema", () => {
    it("validates valid default settings", () => {
      const result = userSettingsSchema.safeParse(DEFAULT_USER_SETTINGS);
      expect(result.success).toBe(true);
    });

    it("rejects invalid currency", () => {
      const result = userSettingsSchema.safeParse({
        ...DEFAULT_USER_SETTINGS,
        defaultCurrency: "XY",
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-uppercase currency", () => {
      const result = userSettingsSchema.safeParse({
        ...DEFAULT_USER_SETTINGS,
        defaultCurrency: "cny",
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid reminderHour", () => {
      const result = userSettingsSchema.safeParse({
        ...DEFAULT_USER_SETTINGS,
        reminderHour: 24,
      });
      expect(result.success).toBe(false);
    });

    it("rejects negative reminderHour", () => {
      const result = userSettingsSchema.safeParse({
        ...DEFAULT_USER_SETTINGS,
        reminderHour: -1,
      });
      expect(result.success).toBe(false);
    });

    it("rejects unsupported timezone", () => {
      const result = userSettingsSchema.safeParse({
        ...DEFAULT_USER_SETTINGS,
        timezone: "Mars/Olympus",
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-boolean reminderEnabled", () => {
      const result = userSettingsSchema.safeParse({
        ...DEFAULT_USER_SETTINGS,
        reminderEnabled: "yes",
      });
      expect(result.success).toBe(false);
    });

    it("accepts valid UTC offset timezone", () => {
      const result = userSettingsSchema.safeParse({
        ...DEFAULT_USER_SETTINGS,
        timezone: "UTC+08:00",
      });
      expect(result.success).toBe(true);
    });

    it("accepts valid negative UTC offset", () => {
      const result = userSettingsSchema.safeParse({
        ...DEFAULT_USER_SETTINGS,
        timezone: "UTC-05:00",
      });
      expect(result.success).toBe(true);
    });

    it("accepts half-hour UTC offset", () => {
      const result = userSettingsSchema.safeParse({
        ...DEFAULT_USER_SETTINGS,
        timezone: "UTC+05:30",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("DEFAULT_USER_SETTINGS", () => {
    it("has valid defaults", () => {
      expect(DEFAULT_USER_SETTINGS.defaultCurrency).toBe("USD");
      expect(DEFAULT_USER_SETTINGS.reminderEnabled).toBe(true);
      expect(DEFAULT_USER_SETTINGS.reminderHour).toBe(9);
      expect(DEFAULT_USER_SETTINGS.timezone).toBe("UTC");
    });
  });

  describe("SUPPORTED_TIMEZONES", () => {
    it("contains exactly 8 timezones", () => {
      expect(SUPPORTED_TIMEZONES.length).toBe(8);
    });

    it("each timezone has a label and iana", () => {
      for (const tz of SUPPORTED_TIMEZONES) {
        expect(tz.label).toBeTruthy();
        expect(tz.iana).toBeTruthy();
      }
    });
  });
});
