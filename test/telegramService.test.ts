import { describe, it, expect, vi } from "vitest";
import { sendMessage } from "../src/services/telegramService.js";
import { Env } from "../src/types/env.js";

function createMockEnv(): Env {
  return {
    BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "test-secret",
    ENCRYPTION_KEY: Buffer.from("0123456789abcdef0123456789abcdef").toString(
      "base64url",
    ),
    USER_HASH_SECRET: "test-hash-secret",
    SUBSCRIPTION_KV: {} as unknown as KVNamespace,
  };
}

describe("telegramService.sendMessage", () => {
  it("returns success on 200 OK", async () => {
    const env = createMockEnv();

    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    global.fetch = mockFetch;

    const result = await sendMessage(env, 123456, "Hello");

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callUrl = mockFetch.mock.calls[0][0];
    expect(callUrl).toContain("bot");
    expect(callUrl).toContain("test-token");
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.chat_id).toBe(123456);
    expect(callBody.text).toBe("Hello");
    expect(callBody.link_preview_options).toEqual({ is_disabled: true });
    expect(callBody.disable_web_page_preview).toBeUndefined();
  });

  it("passes through inline keyboard markup", async () => {
    const env = createMockEnv();

    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    global.fetch = mockFetch;

    await sendMessage(env, 123456, "Hello", {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "已续费一个周期",
              callback_data: "reminder:renew:sub-1:2026-06-01",
            },
          ],
        ],
      },
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.reply_markup.inline_keyboard[0][0]).toEqual({
      text: "已续费一个周期",
      callback_data: "reminder:renew:sub-1:2026-06-01",
    });
  });

  it("allows callers to override link preview options", async () => {
    const env = createMockEnv();

    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    global.fetch = mockFetch;

    await sendMessage(env, 123456, "Hello", {
      link_preview_options: { is_disabled: false },
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.link_preview_options).toEqual({ is_disabled: false });
  });

  it("returns failure with status and description on error", async () => {
    const env = createMockEnv();

    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ok: false, description: "Chat not found" }),
          { status: 400 },
        ),
      );
    global.fetch = mockFetch;

    const result = await sendMessage(env, 999999, "Hello");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.description).toBe("Chat not found");
  });

  it("returns failure without description on unparseable error body", async () => {
    const env = createMockEnv();

    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response("not json", { status: 500 }));
    global.fetch = mockFetch;

    const result = await sendMessage(env, 123456, "Hello");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.description).toBeUndefined();
  });
});

describe("telegramService rich message fallback", () => {
  const view = {
    richMessage: { blocks: [{ type: "paragraph" as const, text: "订阅" }] },
    plainText: "订阅",
    replyMarkup: {
      inline_keyboard: [[{ text: "管理", callback_data: "nav:list" }]],
    },
  };
  it("sends a plain fallback with controls for a rich-format rejection", async () => {
    const { sendRichMessage } = await import(
      "../src/services/telegramService.js"
    );
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ description: "invalid rich message" }), {
          status: 400,
        }),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    global.fetch = mockFetch;
    expect(await sendRichMessage(createMockEnv(), 123, view)).toEqual({
      ok: true,
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toMatchObject({
      text: "订阅",
      reply_markup: view.replyMarkup,
    });
  });
  it.each([400, 401, 403, 429, 500])(
    "does not resend HTTP %i unrelated failures",
    async (status) => {
      const { sendRichMessage } = await import(
        "../src/services/telegramService.js"
      );
      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              description: "unrelated error with private data",
            }),
            { status },
          ),
        );
      global.fetch = mockFetch;
      expect(await sendRichMessage(createMockEnv(), 123, view)).toEqual({
        ok: false,
        status,
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    },
  );
  it("propagates uncertain network failures without a duplicate send", async () => {
    const { sendRichMessage } = await import(
      "../src/services/telegramService.js"
    );
    const mockFetch = vi.fn().mockRejectedValue(new Error("timeout"));
    global.fetch = mockFetch;
    await expect(sendRichMessage(createMockEnv(), 123, view)).rejects.toThrow(
      "timeout",
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
