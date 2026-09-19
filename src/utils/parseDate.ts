import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(customParseFormat);

const SUPPORTED_FORMATS = [
  "YYYY-MM-DD",
  "YYYY-M-DD",
  "YYYY-MM-D",
  "YYYY-M-D",
  "YYYY/MM/DD",
  "YYYY/M/DD",
  "YYYY/MM/D",
  "YYYY/M/D",
  "YYYY.MM.DD",
  "YYYY.M.DD",
  "YYYY.MM.D",
  "YYYY.M.D",
  "DD/MM/YYYY",
  "MM/DD/YYYY",
  "YYYY年MM月DD日",
  "YYYY年M月DD日",
  "YYYY年MM月D日",
  "YYYY年M月D日",
];

const ERROR_MESSAGE = "Invalid date. Use YYYY-MM-DD, YYYY/MM/DD, or YYYY.M.D.";

export function parseFlexibleDate(input: string): {
  date?: string;
  error?: string;
} {
  const trimmed = input.trim();

  for (const fmt of SUPPORTED_FORMATS) {
    const d = dayjs(trimmed, fmt, true);
    if (d.isValid()) return { date: d.format("YYYY-MM-DD") };
  }

  return { error: ERROR_MESSAGE };
}
