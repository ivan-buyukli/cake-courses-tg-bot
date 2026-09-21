import { z } from "zod";
import { detectLocale, locales } from "../bot/i18n.js";
import { userFilters } from "../repositories/courseRepository.js";
import { audiences } from "../models/audience.js";

const uuid = z.uuid();
const locale = z.enum([...locales, "uk"]).transform(detectLocale);
const page = z
  .string()
  .regex(/^\d{1,6}$/)
  .transform(Number);
const ordinal = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,15})$/)
  .transform(Number)
  .refine(Number.isSafeInteger);
const schemas = z.union([
  z.tuple([z.literal("s"), z.enum(["list", "new"])]),
  z.tuple([
    z.literal("s"),
    z.enum(["view", "cancel", "cancelok", "edit"]),
    uuid,
  ]),
  z.tuple([
    z.literal("s"),
    z.enum([
      "resume",
      "discard",
      "content",
      "calendar",
      "noop",
      "preview",
      "publish",
      "confirm",
      "cancel",
      "settime",
      "audience",
    ]),
    uuid,
    page,
  ]),
  z.tuple([
    z.literal("s"),
    z.literal("month"),
    uuid,
    page,
    z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/),
  ]),
  z.tuple([z.literal("s"), z.literal("day"), uuid, page, z.iso.date()]),
  z.tuple([
    z.literal("s"),
    z.literal("hour"),
    uuid,
    page,
    z.string().regex(/^(?:[0-9]|1[0-9]|2[0-3])$/),
  ]),
  z.tuple([
    z.literal("s"),
    z.literal("minute"),
    uuid,
    page,
    z.string().regex(/^(?:[0-9]|[1-5][0-9])$/),
  ]),
  z.tuple([
    z.literal("s"),
    z.literal("at"),
    uuid,
    page,
    z.string().regex(/^\d{13}$/),
  ]),
  z.tuple([z.literal("s"), z.literal("lang"), uuid, page, locale]),
  z.tuple([z.literal("s"), z.literal("aud"), uuid, page, z.enum(audiences)]),
  z.tuple([
    z.literal("s"),
    z.literal("clock"),
    uuid,
    page,
    z.enum(["hp", "hm", "mp", "mm", "fp", "fm"]),
  ]),
  z.tuple([
    z.literal("nav"),
    z.enum(["menu", "buy", "my_course", "language", "stop", "resume", "admin"]),
  ]),
  z.tuple([z.literal("locale"), locale]),
  z.tuple([z.literal("users"), z.enum(userFilters), page]),
  z
    .tuple([z.literal("users"), z.enum(userFilters), ordinal, ordinal, page])
    .refine((data) => data[2] > 0 && data[2] < data[3] && data[4] >= 2),
  z.tuple([
    z.literal("c"),
    z.enum(["list", "new"]),
    z.enum(["sequence", "broadcast"]),
  ]),
  z.tuple([z.literal("c"), z.enum(["view", "edit", "archive"]), uuid]),
  z.tuple([
    z.literal("d"),
    z
      .string()
      .regex(
        /^(?:add|edit|rename|remove|preview|test|translations|publish|discard|resume|timing|delay|calendar|days|dayplus|dayminus|start|previous|applytime|noop|clock(?:hp|hm|mp|mm|fp|fm)|audience|aud(?:non_purchasers|unpaid|unknown|pending)|pick\d{1,2}|lang(?:ua|uk|en))$/,
      ),
    uuid,
    page,
  ]),
  z.tuple([z.literal("pub"), z.enum(["confirm", "cancel"]), uuid, page]),
  z.tuple([z.literal("archive"), z.enum(["confirm", "cancel"]), uuid]),
  z.tuple([z.literal("ct"), z.literal("latest")]),
  z.tuple([z.literal("ct"), z.enum(["status", "stop"]), uuid]),
  z.tuple([z.literal("ct"), z.enum(["real", "fast"]), uuid, page]),
]);

export function parseCallback(data: string) {
  if (data.length > 64) return undefined;
  const result = schemas.safeParse(data.split(":"));
  return result.success ? result.data : undefined;
}
