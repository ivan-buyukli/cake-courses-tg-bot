import { InlineKeyboard } from "grammy";
import type { EditableField } from "../../models/subscriptionEdit.js";

export type { EditableField } from "../../models/subscriptionEdit.js";

export const EDITABLE_FIELDS: readonly {
  field: EditableField;
  label: string;
}[] = [
  { field: "name", label: "Name" },
  { field: "price", label: "Price" },
  { field: "currency", label: "Currency" },
  { field: "cycle", label: "Cycle" },
  { field: "date", label: "Next billing date" },
  { field: "reminder", label: "Reminder preference" },
];

export function editableFieldsKeyboard({
  callbackData,
  backButton,
}: {
  callbackData: (field: EditableField) => string;
  backButton: { label: string; callbackData: string };
}): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  EDITABLE_FIELDS.forEach(({ field, label }, index) => {
    keyboard.text(label, callbackData(field)).primary();
    if (index % 2 === 1) keyboard.row();
  });

  if (EDITABLE_FIELDS.length % 2 === 1) keyboard.row();
  keyboard.text(backButton.label, backButton.callbackData);
  return keyboard;
}
