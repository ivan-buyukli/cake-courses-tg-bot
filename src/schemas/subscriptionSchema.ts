import {
  boolean,
  discriminatedUnion,
  enum as zodEnum,
  iso,
  literal,
  number,
  object,
  string,
} from "zod";
import type { infer as ZodInfer, ZodType } from "zod";
import type { BillingCycle, BillingInterval } from "../models/subscription.js";

export const billingCycleSchema = zodEnum([
  "monthly",
  "yearly",
  "quarterly",
  "weekly",
  "custom",
  "interval",
]) satisfies ZodType<BillingCycle>;

export const subscriptionStatusSchema = zodEnum(["active", "paused"]);

export const billingIntervalSchema = discriminatedUnion("unit", [
  object({
    unit: literal("day"),
    count: number().int().min(1).max(366),
  }),
  object({
    unit: literal("week"),
    count: number().int().min(1).max(52),
  }),
]) satisfies ZodType<BillingInterval>;

export const subscriptionInputSchema = object({
  name: string().min(1).max(100),
  price: number().nonnegative().optional(),
  currency: string().min(1).max(3).optional(),
  billingCycle: billingCycleSchema,
  billingInterval: billingIntervalSchema.optional(),
  nextBillingDate: iso.date(),
  billingAnchorDay: number().int().min(1).max(31).optional(),
  category: string().max(50).optional(),
  note: string().max(500).optional(),
  status: subscriptionStatusSchema,
  isTrial: boolean().optional(),
  autoRenew: boolean().optional(),
}).superRefine((value, ctx) => {
  if (value.billingCycle === "interval" && !value.billingInterval) {
    ctx.addIssue({
      code: "custom",
      path: ["billingInterval"],
      message: "Interval billing cycle requires billingInterval.",
    });
  }
});

export type SubscriptionInput = ZodInfer<typeof subscriptionInputSchema>;
