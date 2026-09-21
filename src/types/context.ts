import type { Context } from "grammy";
import type { UserRecord } from "../models/course.js";
import type { Locale } from "../bot/i18n.js";
import type { CourseRepository } from "../repositories/courseRepository.js";

export type BotContext = Context & {
  user: UserRecord;
  locale: Locale;
  isAdmin: boolean;
  eventAt: number;
  repo: CourseRepository;
  botKey: string;
  timeZone: string;
};
