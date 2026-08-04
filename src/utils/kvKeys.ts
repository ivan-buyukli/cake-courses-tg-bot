export function userProfile(userKey: string): string {
  return `user:${userKey}:profile`;
}

export function userDeleted(userKey: string): string {
  return `user:${userKey}:deleted`;
}

export function userSubscriptionsIndex(userKey: string): string {
  return `user:${userKey}:subs`;
}

export function subscription(userKey: string, subId: string): string {
  return `user:${userKey}:sub:${subId}`;
}

export function reminderDate(date: string): string {
  return `reminders:date:${date}`;
}

export function reminderDatePrefix(date: string): string {
  return `reminders:date:${date}:`;
}

export function reminderDateEntry(
  date: string,
  userKey: string,
  subId: string,
): string {
  return `${reminderDatePrefix(date)}${userKey}:${subId}`;
}

export function parseReminderDateEntryKey(
  key: string,
): { date: string; userKey: string; subscriptionId: string } | null {
  const match = /^reminders:date:(\d{4}-\d{2}-\d{2}):([^:]+):([^:]+)$/.exec(
    key,
  );
  if (!match) return null;

  return {
    date: match[1],
    userKey: match[2],
    subscriptionId: match[3],
  };
}

export function reminderSent(
  userKey: string,
  subId: string,
  billingDate: string,
  localReminderDate: string,
): string {
  return `reminder:sent:v2:${userKey}:${subId}:${billingDate}:${localReminderDate}`;
}
