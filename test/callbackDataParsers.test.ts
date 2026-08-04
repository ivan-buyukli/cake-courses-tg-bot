import { describe, it, expect } from "vitest";
import {
  parseSubCallbackData,
  parseReminderCallbackData,
  parseEditCallbackData,
  parseCycleCallbackData,
  parseAddConfirmCallbackData,
  parseAddPriceCallbackData,
  parseAddCurrencyCallbackData,
  parseCycleIntervalCallbackData,
  parseAddDateCallbackData,
  parseEditCycleCallbackData,
  parseListCallbackData,
  parseSettingsCallbackData,
} from "../src/utils/callbackParser.js";

describe("parseSubCallbackData", () => {
  it("parses view callback", () => {
    const result = parseSubCallbackData("sub:view:abc-123");
    expect(result).toEqual({ action: "view", subId: "abc-123" });
  });
  it("parses edit callback", () => {
    const result = parseSubCallbackData("sub:edit:abc-123");
    expect(result).toEqual({ action: "edit", subId: "abc-123" });
  });
  it("parses delete callback", () => {
    const result = parseSubCallbackData("sub:delete:abc-123");
    expect(result).toEqual({ action: "delete", subId: "abc-123" });
  });
  it("handles subId with colons", () => {
    const result = parseSubCallbackData("sub:view:abc:123:xyz");
    expect(result).toEqual({ action: "view", subId: "abc:123:xyz" });
  });
  it("returns null for invalid prefix", () => {
    expect(parseSubCallbackData("edit:view:abc")).toBeNull();
  });
  it("returns null for missing subId", () => {
    expect(parseSubCallbackData("sub:view")).toBeNull();
  });
  it("returns null for unknown action", () => {
    expect(parseSubCallbackData("sub:unknown:abc")).toBeNull();
  });
});

describe("parseReminderCallbackData", () => {
  it("parses renew callback", () => {
    const result = parseReminderCallbackData(
      "reminder:renew:abc-123:2026-06-01",
    );
    expect(result).toEqual({
      action: "renew",
      subId: "abc-123",
      billingDate: "2026-06-01",
    });
  });

  it("parses subId with colons", () => {
    const result = parseReminderCallbackData(
      "reminder:renew:abc:123:2026-06-01",
    );
    expect(result).toEqual({
      action: "renew",
      subId: "abc:123",
      billingDate: "2026-06-01",
    });
  });

  it("returns null for invalid data", () => {
    expect(
      parseReminderCallbackData("reminder:other:abc:2026-06-01"),
    ).toBeNull();
    expect(parseReminderCallbackData("reminder:renew::2026-06-01")).toBeNull();
    expect(parseReminderCallbackData("reminder:renew:abc:bad-date")).toBeNull();
  });
});

describe("parseEditCallbackData", () => {
  it("parses name edit", () => {
    const result = parseEditCallbackData("edit:name:abc-123");
    expect(result).toEqual({ field: "name", subId: "abc-123" });
  });
  it("parses price edit", () => {
    const result = parseEditCallbackData("edit:price:abc-123");
    expect(result).toEqual({ field: "price", subId: "abc-123" });
  });
  it("parses currency edit", () => {
    const result = parseEditCallbackData("edit:currency:abc-123");
    expect(result).toEqual({ field: "currency", subId: "abc-123" });
  });
  it("parses cycle edit", () => {
    const result = parseEditCallbackData("edit:cycle:abc-123");
    expect(result).toEqual({ field: "cycle", subId: "abc-123" });
  });
  it("parses date edit", () => {
    const result = parseEditCallbackData("edit:date:abc-123");
    expect(result).toEqual({ field: "date", subId: "abc-123" });
  });
  it("parses cancel", () => {
    const result = parseEditCallbackData("edit:cancel:abc-123");
    expect(result).toEqual({ field: "cancel", subId: "abc-123" });
  });
  it("handles subId with colons", () => {
    const result = parseEditCallbackData("edit:price:abc:123");
    expect(result).toEqual({ field: "price", subId: "abc:123" });
  });
  it("returns null for invalid prefix", () => {
    expect(parseEditCallbackData("sub:name:abc")).toBeNull();
  });
  it("returns null for missing subId", () => {
    expect(parseEditCallbackData("edit:name")).toBeNull();
  });
});

describe("parseCycleCallbackData", () => {
  it("parses weekly cycle", () => {
    const result = parseCycleCallbackData("cycle:weekly");
    expect(result).toEqual({ cycle: "weekly" });
  });
  it("parses monthly cycle", () => {
    const result = parseCycleCallbackData("cycle:monthly");
    expect(result).toEqual({ cycle: "monthly" });
  });
  it("returns null for invalid prefix", () => {
    expect(parseCycleCallbackData("edit:weekly")).toBeNull();
  });
  it("returns null for empty cycle", () => {
    expect(parseCycleCallbackData("cycle:")).toBeNull();
  });
});

describe("parseAddConfirmCallbackData", () => {
  it("parses confirm", () => {
    const result = parseAddConfirmCallbackData("add:confirm");
    expect(result).toEqual({ action: "confirm" });
  });
  it("parses cancel", () => {
    const result = parseAddConfirmCallbackData("add:cancel");
    expect(result).toEqual({ action: "cancel" });
  });
  it("parses trial toggle", () => {
    const result = parseAddConfirmCallbackData("add:toggle_trial");
    expect(result).toEqual({ action: "toggle_trial" });
  });
  it("parses auto-renew toggle", () => {
    const result = parseAddConfirmCallbackData("add:toggle_autorenew");
    expect(result).toEqual({ action: "toggle_autorenew" });
  });
  it("parses review edit actions", () => {
    expect(parseAddConfirmCallbackData("add:edit_name")).toEqual({
      action: "edit_name",
    });
    expect(parseAddConfirmCallbackData("add:edit_price")).toEqual({
      action: "edit_price",
    });
    expect(parseAddConfirmCallbackData("add:edit_currency")).toEqual({
      action: "edit_currency",
    });
    expect(parseAddConfirmCallbackData("add:edit_cycle")).toEqual({
      action: "edit_cycle",
    });
    expect(parseAddConfirmCallbackData("add:edit_date")).toEqual({
      action: "edit_date",
    });
  });
  it("returns null for unknown action", () => {
    expect(parseAddConfirmCallbackData("add:other")).toBeNull();
  });
  it("returns null for invalid prefix", () => {
    expect(parseAddConfirmCallbackData("delete:confirm")).toBeNull();
  });
});

describe("parseAddCurrencyCallbackData", () => {
  it("parses selected currency", () => {
    const result = parseAddCurrencyCallbackData("addcurrency:CNY");
    expect(result).toEqual({ action: "select", currency: "CNY" });
  });
  it("parses skip", () => {
    const result = parseAddCurrencyCallbackData("addcurrency:skip");
    expect(result).toEqual({ action: "skip" });
  });
  it("parses other", () => {
    const result = parseAddCurrencyCallbackData("addcurrency:other");
    expect(result).toEqual({ action: "other" });
  });
  it("parses back", () => {
    const result = parseAddCurrencyCallbackData("addcurrency:back");
    expect(result).toEqual({ action: "back" });
  });
  it("parses cancel", () => {
    const result = parseAddCurrencyCallbackData("addcurrency:cancel");
    expect(result).toEqual({ action: "cancel" });
  });
  it("returns null for invalid currency", () => {
    expect(parseAddCurrencyCallbackData("addcurrency:CN")).toBeNull();
  });
});

describe("parseAddPriceCallbackData", () => {
  it("parses skip", () => {
    expect(parseAddPriceCallbackData("addprice:skip")).toEqual({
      action: "skip",
    });
  });

  it("parses cancel", () => {
    expect(parseAddPriceCallbackData("addprice:cancel")).toEqual({
      action: "cancel",
    });
  });

  it("returns null for unknown action", () => {
    expect(parseAddPriceCallbackData("addprice:other")).toBeNull();
  });
});

describe("parseCycleIntervalCallbackData", () => {
  it("parses preset", () => {
    expect(parseCycleIntervalCallbackData("cycleint:preset:30d")).toEqual({
      action: "preset",
      value: "30d",
    });
  });

  it("parses other", () => {
    expect(parseCycleIntervalCallbackData("cycleint:other")).toEqual({
      action: "other",
    });
  });

  it("parses back", () => {
    expect(parseCycleIntervalCallbackData("cycleint:back")).toEqual({
      action: "back",
    });
  });

  it("parses cancel", () => {
    expect(parseCycleIntervalCallbackData("cycleint:cancel")).toEqual({
      action: "cancel",
    });
  });

  it("returns null for invalid preset", () => {
    expect(
      parseCycleIntervalCallbackData("cycleint:preset:monthly"),
    ).toBeNull();
  });
});

describe("parseAddDateCallbackData", () => {
  it("parses picked date", () => {
    const result = parseAddDateCallbackData("adddate:pick:2026-06-01");
    expect(result).toEqual({ action: "pick", date: "2026-06-01" });
  });
  it("parses month navigation", () => {
    const result = parseAddDateCallbackData("adddate:month:2026-06");
    expect(result).toEqual({ action: "month", month: "2026-06" });
  });
  it("parses noop", () => {
    const result = parseAddDateCallbackData("adddate:noop");
    expect(result).toEqual({ action: "noop" });
  });
  it("parses cancel", () => {
    const result = parseAddDateCallbackData("adddate:cancel");
    expect(result).toEqual({ action: "cancel" });
  });
  it("parses confirm", () => {
    const result = parseAddDateCallbackData("adddate:confirm");
    expect(result).toEqual({ action: "confirm" });
  });
  it("parses show", () => {
    const result = parseAddDateCallbackData("adddate:show");
    expect(result).toEqual({ action: "show" });
  });
  it("returns null for malformed date", () => {
    expect(parseAddDateCallbackData("adddate:pick:2026-6-1")).toBeNull();
  });
});

describe("parseEditCycleCallbackData", () => {
  it("parses edit cycle", () => {
    const result = parseEditCycleCallbackData("editcycle:monthly:abc-123");
    expect(result).toEqual({ cycle: "monthly", subId: "abc-123" });
  });
  it("handles subId with colons", () => {
    const result = parseEditCycleCallbackData("editcycle:yearly:abc:123");
    expect(result).toEqual({ cycle: "yearly", subId: "abc:123" });
  });
  it("returns null for invalid prefix", () => {
    expect(parseEditCycleCallbackData("cycle:monthly:abc")).toBeNull();
  });
  it("returns null for missing cycle", () => {
    expect(parseEditCycleCallbackData("editcycle::abc")).toBeNull();
  });
  it("returns null for missing subId", () => {
    expect(parseEditCycleCallbackData("editcycle:monthly")).toBeNull();
  });
});

describe("parseListCallbackData", () => {
  describe("page action", () => {
    it("parses page callback", () => {
      const result = parseListCallbackData("list:page:0");
      expect(result).toEqual({ action: "page", page: 0 });
    });
    it("parses page callback with multi-digit page", () => {
      const result = parseListCallbackData("list:page:12");
      expect(result).toEqual({ action: "page", page: 12 });
    });
    it("returns null for negative page", () => {
      expect(parseListCallbackData("list:page:-1")).toBeNull();
    });
    it("returns null for non-numeric page", () => {
      expect(parseListCallbackData("list:page:abc")).toBeNull();
    });
  });

  describe("back action", () => {
    it("parses back callback", () => {
      const result = parseListCallbackData("list:back:2");
      expect(result).toEqual({ action: "back", page: 2 });
    });
  });

  describe("select action", () => {
    it("parses select callback", () => {
      const result = parseListCallbackData("list:select:abc-123:0");
      expect(result).toEqual({ action: "select", subId: "abc-123", page: 0 });
    });
    it("handles subId with colons", () => {
      const result = parseListCallbackData("list:select:abc:123:xyz:0");
      expect(result).toEqual({
        action: "select",
        subId: "abc:123:xyz",
        page: 0,
      });
    });
  });

  describe("detail action", () => {
    it("parses detail callback", () => {
      const result = parseListCallbackData("list:detail:abc-123:1");
      expect(result).toEqual({ action: "detail", subId: "abc-123", page: 1 });
    });
  });

  describe("edit action", () => {
    it("parses edit callback", () => {
      const result = parseListCallbackData("list:edit:abc-123:0");
      expect(result).toEqual({ action: "edit", subId: "abc-123", page: 0 });
    });
  });

  describe("pause action", () => {
    it("parses pause callback", () => {
      const result = parseListCallbackData("list:pause:abc-123:0");
      expect(result).toEqual({ action: "pause", subId: "abc-123", page: 0 });
    });
  });

  describe("resume action", () => {
    it("parses resume callback", () => {
      const result = parseListCallbackData("list:resume:abc-123:0");
      expect(result).toEqual({ action: "resume", subId: "abc-123", page: 0 });
    });
  });

  describe("del action", () => {
    it("parses del callback", () => {
      const result = parseListCallbackData("list:del:abc-123:0");
      expect(result).toEqual({ action: "del", subId: "abc-123", page: 0 });
    });
  });

  describe("delok action", () => {
    it("parses delok callback", () => {
      const result = parseListCallbackData("list:delok:abc-123:0");
      expect(result).toEqual({ action: "delok", subId: "abc-123", page: 0 });
    });
  });

  describe("delno action", () => {
    it("parses delno callback", () => {
      const result = parseListCallbackData("list:delno:abc-123:0");
      expect(result).toEqual({ action: "delno", subId: "abc-123", page: 0 });
    });
  });

  describe("editField action", () => {
    it("parses name field", () => {
      const result = parseListCallbackData("list:ef:name:abc-123:0");
      expect(result).toEqual({
        action: "editField",
        subId: "abc-123",
        field: "name",
        page: 0,
      });
    });
    it("parses price field", () => {
      const result = parseListCallbackData("list:ef:price:abc-123:0");
      expect(result).toEqual({
        action: "editField",
        subId: "abc-123",
        field: "price",
        page: 0,
      });
    });
    it("parses currency field", () => {
      const result = parseListCallbackData("list:ef:currency:abc-123:0");
      expect(result).toEqual({
        action: "editField",
        subId: "abc-123",
        field: "currency",
        page: 0,
      });
    });
    it("parses cycle field", () => {
      const result = parseListCallbackData("list:ef:cycle:abc-123:0");
      expect(result).toEqual({
        action: "editField",
        subId: "abc-123",
        field: "cycle",
        page: 0,
      });
    });
    it("parses date field", () => {
      const result = parseListCallbackData("list:ef:date:abc-123:0");
      expect(result).toEqual({
        action: "editField",
        subId: "abc-123",
        field: "date",
        page: 0,
      });
    });
    it("handles subId with colons", () => {
      const result = parseListCallbackData("list:ef:name:abc:123:5");
      expect(result).toEqual({
        action: "editField",
        subId: "abc:123",
        field: "name",
        page: 5,
      });
    });
    it("returns null for missing field", () => {
      expect(parseListCallbackData("list:ef::abc-123:0")).toBeNull();
    });
    it("returns null for missing subId", () => {
      expect(parseListCallbackData("list:ef:name::0")).toBeNull();
    });
    it("returns null for negative page", () => {
      expect(parseListCallbackData("list:ef:name:abc-123:-1")).toBeNull();
    });
  });

  describe("invalid inputs", () => {
    it("returns null for invalid prefix", () => {
      expect(parseListCallbackData("sub:page:0")).toBeNull();
    });
    it("returns null for unknown action", () => {
      expect(parseListCallbackData("list:unknown:abc:0")).toBeNull();
    });
    it("returns null for empty string", () => {
      expect(parseListCallbackData("")).toBeNull();
    });
    it("returns null for select without page", () => {
      expect(parseListCallbackData("list:select:abc-123")).toBeNull();
    });
    it("returns null for select with non-numeric page", () => {
      expect(parseListCallbackData("list:select:abc-123:abc")).toBeNull();
    });
  });
});

describe("parseSettingsCallbackData timezone offsets", () => {
  it("parses privacy and data navigation actions", () => {
    expect(parseSettingsCallbackData("settings:privacy")).toEqual({
      action: "privacy",
    });
    expect(parseSettingsCallbackData("settings:export")).toEqual({
      action: "export",
    });
    expect(parseSettingsCallbackData("settings:delete")).toEqual({
      action: "delete",
    });
    expect(parseSettingsCallbackData("settings:back")).toEqual({
      action: "back",
    });
    expect(parseSettingsCallbackData("settings:cancel")).toEqual({
      action: "cancel",
    });
  });

  it("parses timezone offset menu", () => {
    expect(parseSettingsCallbackData("settings:tzoffset")).toEqual({
      action: "timezone_offset_menu",
    });
  });

  it("parses timezone offset preset", () => {
    expect(parseSettingsCallbackData("settings:tzoffset:+5:30")).toEqual({
      action: "timezone_offset",
      offset: "+5:30",
    });
  });

  it("parses timezone offset other", () => {
    expect(parseSettingsCallbackData("settings:tzoffset:other")).toEqual({
      action: "timezone_offset_other",
    });
  });

  it("parses timezone offset back", () => {
    expect(parseSettingsCallbackData("settings:tzoffset:back")).toEqual({
      action: "timezone_offset_back",
    });
  });
});
