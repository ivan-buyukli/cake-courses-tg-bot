import { InlineKeyboard } from "grammy";
import { editableFieldsKeyboard } from "./editFields.js";

export function editMenuKeyboard(subId: string): InlineKeyboard {
  return editableFieldsKeyboard({
    callbackData: (field) => `edit:${field}:${subId}`,
    backButton: { label: "Cancel", callbackData: `edit:cancel:${subId}` },
  });
}
