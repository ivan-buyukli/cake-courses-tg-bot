export const EDITABLE_FIELD_VALUES = [
  "name",
  "price",
  "currency",
  "cycle",
  "date",
  "reminder",
] as const;

export type EditableField = (typeof EDITABLE_FIELD_VALUES)[number];
export type ScalarEditableField = Exclude<EditableField, "cycle" | "reminder">;
export type EditCallbackField = EditableField | "cancel";
export type ListEditableField = EditableField | "trial" | "autorenew";

const editableFields = new Set<string>(EDITABLE_FIELD_VALUES);

export function isEditableField(value: string): value is EditableField {
  return editableFields.has(value);
}

export function isEditCallbackField(value: string): value is EditCallbackField {
  return value === "cancel" || isEditableField(value);
}

export function isListEditableField(value: string): value is ListEditableField {
  return value === "trial" || value === "autorenew" || isEditableField(value);
}
