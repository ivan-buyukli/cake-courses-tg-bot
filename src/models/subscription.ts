export type BillingCycle =
  | "monthly"
  | "yearly"
  | "quarterly"
  | "weekly"
  | "custom"
  | "interval";

export type SubscriptionStatus = "active" | "paused";

export interface BillingInterval {
  unit: "day" | "week" | "month" | "year";
  count: number;
}

export interface SubscriptionReminderPolicy {
  mode: "once";
  daysBefore: 1;
}

export interface Subscription {
  id: string;
  name: string;
  price?: number;
  currency?: string;
  billingCycle: BillingCycle;
  billingInterval?: BillingInterval;
  nextBillingDate: string;
  billingAnchorDay?: number;
  category?: string;
  note?: string;
  status: SubscriptionStatus;
  isTrial?: boolean;
  autoRenew?: boolean;
  /** Missing means the subscription follows the default repeated reminder window. */
  reminderPolicy?: SubscriptionReminderPolicy;
  createdAt: string;
  updatedAt: string;
}

export interface StoredSubscription {
  id: string;
  encryptedPayload: string;
  nextBillingDate: string;
  billingCycle: BillingCycle;
  billingInterval?: BillingInterval;
  billingAnchorDay?: number;
  status: SubscriptionStatus;
  isTrial?: boolean;
  autoRenew?: boolean;
  createdAt: string;
  updatedAt: string;
}
