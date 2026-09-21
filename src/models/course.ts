import type { Locale } from "../bot/i18n.js";

export interface Identity {
  telegramId: number;
  chatId: number;
  firstName: string;
  lastName?: string;
  username?: string;
}

export interface UserRecord {
  id: string;
  user_key: string;
  identity_cipher: string;
  locale: Locale;
  locale_explicit: number;
  is_admin: number;
  first_seen_at: number;
  last_seen_at: number;
  started_at: number | null;
  opted_out: number;
  blocked: number;
  purchase_suppressed: number;
  payment_status:
    | "unknown"
    | "unpaid"
    | "pending"
    | "paid"
    | "refunded"
    | "disputed";
  last_delivery_at: number;
  sequence_progress?: string | null;
}

export interface MediaInput {
  type: "photo" | "video";
  fileId: string;
  uniqueId: string;
  size?: number;
  width: number;
  height: number;
  duration?: number;
}

export interface MediaRecord {
  id: string;
  owner_id: string;
  bot_key: string;
  media_type: "photo" | "video";
  file_unique_id: string;
  file_id_cipher: string;
  file_size: number | null;
  width: number;
  height: number;
  duration: number | null;
  state: "pending" | "ready" | "needs_upload";
  created_at: number;
}
