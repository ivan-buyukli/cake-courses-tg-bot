import { InlineKeyboard } from "grammy";

export function binaryActionKeyboard({
  confirmLabel = "✅ 确认",
  confirmData,
  cancelLabel = "❌ 取消",
  cancelData,
  confirmStyle = "success",
}: {
  confirmLabel?: string;
  confirmData: string;
  cancelLabel?: string;
  cancelData: string;
  confirmStyle?: "primary" | "success" | "danger";
}): InlineKeyboard {
  const keyboard = new InlineKeyboard().text(confirmLabel, confirmData);
  keyboard[confirmStyle]();
  return keyboard.text(cancelLabel, cancelData);
}

export function confirmationKeyboard(
  actionPrefix: string,
  data: string,
  options?: {
    confirmLabel?: string;
    cancelLabel?: string;
  },
): InlineKeyboard {
  return binaryActionKeyboard({
    confirmLabel: options?.confirmLabel,
    confirmData: `${actionPrefix}:confirm:${data}`,
    cancelLabel: options?.cancelLabel,
    cancelData: `${actionPrefix}:cancel:${data}`,
    confirmStyle: actionPrefix.includes("delete") ? "danger" : "success",
  });
}
