export function isCancelInput(text: string): boolean {
  const input = text.trim().toLowerCase();
  return input === "/cancel" || input === "cancel" || input === "取消";
}
