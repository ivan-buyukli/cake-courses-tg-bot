import { boolean, number, object, string } from "zod";
import type { infer as ZodInfer } from "zod";
import { isValidTimezone } from "../models/userSettings.js";

export const userSettingsSchema = object({
  defaultCurrency: string()
    .min(3)
    .max(3)
    .regex(/^[A-Z]{3}$/, { error: "Must be a 3-letter currency code" }),
  reminderEnabled: boolean(),
  reminderHour: number().int().min(0).max(23),
  timezone: string().refine(isValidTimezone, {
    error: "Must be a valid IANA timezone or UTC offset (e.g., +8, -5, +5:30)",
  }),
});

export type UserSettingsInput = ZodInfer<typeof userSettingsSchema>;
