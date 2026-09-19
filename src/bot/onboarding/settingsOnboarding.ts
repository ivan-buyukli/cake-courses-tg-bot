import { UserRepository } from "../../repositories/userRepository.js";

export const SETTINGS_ONBOARDING_MESSAGE =
  "Reminder: You have not configured your preferences yet.\n" +
  "Use /settings to set your reminder time, timezone, and default currency for future subscriptions.";

export async function shouldShowSettingsOnboarding(
  userRepo: UserRepository,
  userKey: string,
  encryptionKey: string,
): Promise<boolean> {
  const profile = await userRepo.getUserProfile(userKey, encryptionKey);
  return !profile?.settings;
}
