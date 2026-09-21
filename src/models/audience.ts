import type { UserRecord } from "./course.js";

export const audiences = [
  "non_purchasers",
  "unpaid",
  "unknown",
  "pending",
] as const;
export type Audience = (typeof audiences)[number];

export function matchesAudience(
  user: Pick<UserRecord, "payment_status">,
  audience: Audience = "non_purchasers",
): boolean {
  return (
    user.payment_status !== "paid" &&
    (audience === "non_purchasers" || user.payment_status === audience)
  );
}
