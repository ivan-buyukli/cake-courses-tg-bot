/** Inspect descriptions only to classify errors; never include them in logs. */
export function isRichMessageRejected(
  status?: number,
  description = "",
): boolean {
  return (
    (status === 400 || status === 404) &&
    /rich.?message|rich.?text|rich.?block|can't parse|cannot parse|unsupported.*(format|method)|method.*(not found|not supported)|invalid.*(block|entit|format)/i.test(
      description,
    )
  );
}

export function telegramErrorInfo(error: unknown): {
  status?: number;
  description: string;
} {
  if (!error || typeof error !== "object") return { description: "" };
  const value = error as { error_code?: unknown; description?: unknown };
  return {
    status: typeof value.error_code === "number" ? value.error_code : undefined,
    description: typeof value.description === "string" ? value.description : "",
  };
}

export function isMessageNotModified(error: unknown): boolean {
  const { status, description } = telegramErrorInfo(error);
  return status === 400 && /message is not modified/i.test(description);
}
