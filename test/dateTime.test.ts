import { formatDateTime } from "../src/utils/dateTime.js";
import { parseSchedule } from "../src/models/campaign.js";

describe("readable dates and explicit timezones", () => {
  it("formats calendar timestamps with full month names, minutes and a separate timezone", () => {
    const now = Date.parse("2026-09-20T13:52:36Z");
    expect(formatDateTime(now, "ua", "Europe/Berlin", "calendar")).toBe(
      "20 вересня 2026 р., 15:52",
    );
    expect(formatDateTime(now, "en", "Europe/Berlin", "calendar")).toBe(
      "20 September 2026, 15:52",
    );
    expect(formatDateTime(now, "en", "Europe/Kyiv", "calendar")).toBe(
      "20 September 2026, 16:52",
    );
    expect(
      formatDateTime(
        Date.parse("2027-01-01T23:05:00Z"),
        "ua",
        "Europe/Berlin",
        "calendar",
      ),
    ).toBe("2 січня 2027 р., 00:05");
  });
  it("formats winter and summer correctly in Europe/Berlin", () => {
    expect(formatDateTime(Date.parse("2027-01-01T10:00:00Z"), "en")).toBe(
      "01 Jan 2027, 11:00:00 (Europe/Berlin)",
    );
    expect(formatDateTime(Date.parse("2027-07-01T10:00:00Z"), "en")).toBe(
      "01 Jul 2027, 12:00:00 (Europe/Berlin)",
    );
  });
  it("localizes dates and respects the configured timezone", () => {
    const date = formatDateTime(
      Date.parse("2027-01-01T10:00:00Z"),
      "ua",
      "Europe/Kyiv",
    );
    expect(date).toContain("12:00:00");
    expect(date).toContain("Europe/Kyiv");
    expect(date).not.toMatch(/2027-01-01T/);
  });
  it("accepts readable CET/CEST dates and retains explicit ISO offset compatibility", () => {
    expect(parseSchedule("01.01.2027 10:00 CET", 0)).toBe(
      Date.parse("2027-01-01T09:00Z"),
    );
    expect(parseSchedule("01.07.2027 10:00 CEST", 0)).toBe(
      Date.parse("2027-07-01T08:00Z"),
    );
    expect(parseSchedule("01.07.2027 10:00 +02:00", 0)).toBe(
      Date.parse("2027-07-01T08:00Z"),
    );
    expect(parseSchedule("2027-01-01T10:00+01:00", 0)).toBe(
      Date.parse("2027-01-01T09:00Z"),
    );
    expect(parseSchedule("31.02.2027 10:00 CET", 0)).toBeUndefined();
    expect(parseSchedule("01.01.2027 25:00 CET", 0)).toBeUndefined();
  });
});
