import type { Api, InlineKeyboard } from "grammy";
import type { CampaignStep } from "../models/campaign.js";
import type { CourseEnv } from "../schemas/envSchema.js";
import { CourseRepository } from "../repositories/courseRepository.js";
import { hashUserId } from "../crypto/userHash.js";
import { mediaFromMessage } from "../utils/media.js";
import { telegramErrorInfo } from "../utils/telegramErrors.js";

// Live deliveries and private tests share media validation, transport and reference refresh.
export async function sendCampaignMessage(
  api: Api,
  env: CourseEnv,
  chatId: number,
  variant: NonNullable<CampaignStep["variants"]["en"]>,
  beforeSend: () => Promise<boolean>,
  recordSuccess: (messageId: number) => Promise<void>,
  replyMarkup?: InlineKeyboard,
): Promise<void> {
  const users = new CourseRepository(env);
  const asset = variant.mediaId ? await users.getMedia(variant.mediaId) : null;
  if (
    variant.mediaId &&
    (!asset ||
      asset.state !== "ready" ||
      asset.bot_key !==
        (await hashUserId(
          Number(env.BOT_TOKEN.split(":")[0]),
          env.USER_HASH_SECRET,
        )))
  )
    throw new Error("Media unavailable");
  const fileId = asset ? await users.mediaFileId(asset) : undefined;
  // The queue's single consumer keeps background traffic below 20 messages/sec.
  await new Promise((resolve) => setTimeout(resolve, 60));
  if (!(await beforeSend())) return;
  const options = replyMarkup ? { reply_markup: replyMarkup } : {};
  const sent =
    asset?.media_type === "photo"
      ? await api.sendPhoto(chatId, fileId!, {
          caption: variant.text,
          ...options,
        })
      : asset?.media_type === "video"
        ? await api.sendVideo(chatId, fileId!, {
            caption: variant.text,
            ...options,
          })
        : await api.sendMessage(chatId, variant.text, options);
  await recordSuccess(sent.message_id);
  if (asset) {
    try {
      const returned = mediaFromMessage(sent);
      if (returned) await users.verifyMedia(asset, returned);
    } catch {
      // A failed reference refresh must not retry an already recorded send.
    }
  }
}

export function deliveryFailure(
  error: unknown,
  sending: boolean,
  attempts: number,
) {
  const { status, description } = telegramErrorInfo(error);
  let state = "failed";
  let retryDelay: number | undefined;
  const blocked = status === 403 && /blocked/i.test(description);
  if (status === 429 || (status && status >= 500)) {
    const retryAfter = (error as { parameters?: { retry_after?: number } })
      .parameters?.retry_after;
    retryDelay = Math.min(43_200, Math.max(5, retryAfter ?? 2 ** attempts));
    state = attempts >= 5 ? "failed" : "pending";
  } else if (sending && !status) state = "unknown";
  else if (blocked) state = "pending";
  return { state, retryDelay, blocked };
}
