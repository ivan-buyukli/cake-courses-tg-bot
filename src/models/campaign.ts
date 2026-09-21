import { z } from "zod";
import { locales } from "../bot/i18n.js";
import { Temporal } from "@js-temporal/polyfill";
import { audiences } from "./audience.js";

export const calendarTimingSchema = z.object({
  days: z.number().int().min(0).max(365),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  timeZone: z
    .string()
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }),
  anchor: z.enum(["start", "previous"]),
});

export const variantSchema = z
  .object({ text: z.string().max(4096), mediaId: z.uuid().optional() })
  .refine((v) => !!v.text.trim() || !!v.mediaId)
  .refine((v) => !v.mediaId || v.text.length <= 1024);
const variants = z.object({
  en: variantSchema.optional(),
  ua: variantSchema.optional(),
  uk: variantSchema.optional(),
  pl: variantSchema.optional(),
});
export const stepSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(100).optional(),
  offsetMinutes: z.number().int().min(0).max(525600),
  calendar: calendarTimingSchema.optional(),
  variants,
});
export const campaignSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(["sequence", "broadcast"]),
    title: z.string().trim().min(1).max(100),
    baseRevision: z.number().int().nonnegative(),
    // Retain the ability to read immutable campaigns published in a retired language.
    fallback: z.enum([...locales, "uk", "pl"]),
    steps: z.array(stepSchema).min(1).max(30),
    scheduledAt: z.number().int().positive().optional(),
    audience: z.enum(audiences).optional(),
  })
  .superRefine((campaign, ctx) => {
    campaign.steps.forEach((step, index) => {
      if (!localizedVariant(step.variants, campaign.fallback))
        ctx.addIssue({
          code: "custom",
          message: "Fallback content missing",
          path: ["steps", index],
        });
      if (
        index &&
        !step.calendar &&
        !campaign.steps[index - 1]!.calendar &&
        step.offsetMinutes < campaign.steps[index - 1]!.offsetMinutes
      )
        ctx.addIssue({
          code: "custom",
          message: "Offsets must be ordered",
          path: ["steps", index],
        });
    });
    if (
      campaign.kind === "broadcast" &&
      (campaign.steps.length !== 1 || !campaign.scheduledAt)
    )
      ctx.addIssue({
        code: "custom",
        message: "Broadcast requires one message and a time",
      });
  });
export type Campaign = z.infer<typeof campaignSchema>;
export type CampaignStep = z.infer<typeof stepSchema>;
export function localizedVariant(
  variants: CampaignStep["variants"],
  language: keyof CampaignStep["variants"],
) {
  return (
    variants[language] ??
    (language === "ua"
      ? variants.uk
      : language === "uk"
        ? variants.ua
        : undefined)
  );
}

export function sequenceStepDueAt(
  step: CampaignStep,
  startedAt: number,
  previousSentAt?: number,
): number {
  let planned = startedAt + step.offsetMinutes * 60_000;
  if (step.calendar) {
    const { days, time, timeZone, anchor } = step.calendar;
    const base =
      anchor === "previous" ? (previousSentAt ?? startedAt) : startedAt;
    const date = Temporal.Instant.fromEpochMilliseconds(base)
      .toZonedDateTimeISO(timeZone)
      .toPlainDate()
      .add({ days });
    // Relative schedules span unknown dates: shift spring gaps forward and use the first autumn occurrence.
    planned = date
      .toPlainDateTime(Temporal.PlainTime.from(time))
      .toZonedDateTime(timeZone, {
        disambiguation: "compatible",
      }).epochMilliseconds;
    planned = Math.max(planned, startedAt);
  }
  return previousSentAt === undefined
    ? planned
    : Math.max(planned, previousSentAt + 60_000);
}
export interface CampaignRow {
  id: string;
  kind: Campaign["kind"];
  title: string;
  revision: number;
  current_version: string | null;
  archived: number;
  ordinal: number;
}
export interface Enrollment {
  id: string;
  user_id: string;
  campaign_id: string;
  version_id: string;
  kind: Campaign["kind"];
  step: number;
  started_at: number;
  due_at: number;
  state: string;
}
export interface Delivery {
  id: string;
  enrollment_id: string;
  step: number;
  attempts: number;
  lease_token: string;
  state: string;
  available_at: number;
}

export function parseSchedule(
  value: string,
  now = Date.now(),
): number | undefined {
  const friendly =
    /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}:\d{2}(?::\d{2})?) (CET|CEST|UTC|[+-]\d{2}:\d{2})$/.exec(
      value.trim(),
    );
  if (friendly) {
    const zones: Record<string, string> = {
      CET: "+01:00",
      CEST: "+02:00",
      UTC: "Z",
    };
    value = `${friendly[3]}-${friendly[2]}-${friendly[1]}T${friendly[4]}${zones[friendly[5]!] ?? friendly[5]}`;
  }
  // Requiring an explicit UTC offset avoids silently guessing the admin's timezone.
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  )
    return undefined;
  if (
    !z.iso.date().safeParse(value.slice(0, 10)).success ||
    Number(value.slice(11, 13)) > 23 ||
    Number(value.slice(14, 16)) > 59
  )
    return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > now ? parsed : undefined;
}
