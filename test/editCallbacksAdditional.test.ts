import { describe, expect, it, vi } from "vitest";
import {
  editCancelCallback,
  editFieldCallback,
} from "../src/bot/callbacks/editCallbacks.js";
import type { BotContext } from "../src/types/context.js";

function createContext(
  data: string,
  overrides: Partial<BotContext> = {},
): BotContext {
  return {
    userKey: "user-key",
    requestId: "request-id",
    callbackQuery: { data },
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    conversation: {
      enter: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  } as unknown as BotContext;
}

describe("edit callbacks", () => {
  it("answers when userKey is missing", async () => {
    const ctx = createContext("edit:name:sub-1", { userKey: undefined });

    await editFieldCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      "Unable to identify your account.",
    );
    expect(ctx.conversation.enter).not.toHaveBeenCalled();
  });

  it("answers invalid callback data", async () => {
    const ctx = createContext("edit:oops");

    await editFieldCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      "Invalid button data.",
    );
    expect(ctx.conversation.enter).not.toHaveBeenCalled();
  });

  it("enters editCycle for cycle edits", async () => {
    const ctx = createContext("edit:cycle:sub-1");

    await editFieldCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(undefined);
    expect(ctx.conversation.enter).toHaveBeenCalledWith("editCycle", "sub-1");
  });

  it("enters editReminder for reminder policy edits", async () => {
    const ctx = createContext("edit:reminder:sub-1");

    await editFieldCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(undefined);
    expect(ctx.conversation.enter).toHaveBeenCalledWith(
      "editReminder",
      "sub-1",
    );
  });

  it("enters editField for scalar edits", async () => {
    const ctx = createContext("edit:price:sub-1");

    await editFieldCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(undefined);
    expect(ctx.conversation.enter).toHaveBeenCalledWith(
      "editField",
      "sub-1",
      "price",
    );
  });

  it("reports operation failure when conversation entry throws", async () => {
    const ctx = createContext("edit:name:sub-1");
    vi.mocked(ctx.conversation.enter).mockRejectedValueOnce(new Error("boom"));

    await editFieldCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenLastCalledWith(
      "Operation failed. Please try again later.",
    );
  });

  it("cancels editing and updates the message", async () => {
    const ctx = createContext("edit:cancel:sub-1");

    await editCancelCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith("Cancelled.");
    expect(ctx.editMessageText).toHaveBeenCalledWith("Editing cancelled.");
  });

  it("handles cancel without userKey", async () => {
    const ctx = createContext("edit:cancel:sub-1", { userKey: undefined });

    await editCancelCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      "Unable to identify your account.",
    );
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      "Unable to identify your account.",
    );
  });
});
