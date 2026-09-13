import { describe, it, expect } from "vitest";
import type { Subscription } from "../src/models/subscription.js";
import {
  listPresentation,
  detailPresentation,
} from "../src/bot/ui/subscriptionPresentation.js";
import { reminderPresentation } from "../src/bot/ui/reminderPresentation.js";

function sub(index: number, extra: Partial<Subscription> = {}): Subscription {
  return {
    id: `sub-${index}`,
    name: `订阅 ${index}`,
    price: 0,
    currency: "EUR",
    billingCycle: "monthly",
    nextBillingDate: "2026-09-14",
    createdAt: "2026-09-01",
    updatedAt: "2026-09-01",
    ...extra,
  };
}

describe("dense subscription presentations", () => {
  it.each([1, 12, 13, 25])(
    "renders %i subscriptions with 12 items per page and only pagination below",
    (count) => {
      const subs = Array.from({ length: count }, (_, i) => sub(i));
      const first = listPresentation(subs, 0);
      const table = first.richMessage.blocks?.find((b) => b.type === "table");
      expect(table?.cells).toHaveLength(Math.min(count, 12) + 1);
      const firstCell = table?.cells[1][0].text;
      expect(firstCell).toEqual([
        {
          type: "button",
          button: {
            text: "订阅 0",
            style: "link",
            callback_data: "list:select:sub-0:0",
          },
        },
      ]);
      expect(
        first.replyMarkup?.inline_keyboard
          .flat()
          .every((b) => b.callback_data?.startsWith("list:page:")),
      ).toBe(true);
      expect(first.plainReplyMarkup?.inline_keyboard.flat()[0]).toEqual({
        text: "1",
        callback_data: "list:select:sub-0:0",
      });
      if (count > 12) {
        const second = listPresentation(subs, 1);
        expect(second.plainText).toContain("13. 订阅 12");
        expect(second.plainText).not.toContain("12. 订阅 11");
      }
    },
  );
  it("clamps a deleted final page and handles empty data", () => {
    expect(listPresentation([sub(1)], 3).plainText).toContain("第 1/1 页");
    expect(listPresentation([], 0).plainText).toContain("0 项");
  });
  it("keeps long names and markup literal, unknown prices distinct from zero, and paused dates explicit", () => {
    const name =
      "中文 <b>literal</b> [name](link) 😀 " + "Long name ".repeat(6);
    const view = listPresentation(
      [
        sub(1, { name, isTrial: true, autoRenew: false }),
        sub(2, { price: undefined, status: "paused" }),
      ],
      0,
    );
    expect(view.plainText).toContain(name);
    expect(view.plainText).toContain("0 EUR");
    expect(view.plainText).toContain("— · 已暂停");
    expect(view.plainText).toContain("体验 · 已停续费");
    expect(view.richMessage.html).toBeUndefined();
    expect(view.richMessage.markdown).toBeUndefined();
  });
  it("folds notes without hiding any detail action", () => {
    const view = detailPresentation(sub(1, { note: "private notes" }), 2);
    expect(
      view.richMessage.blocks?.find((b) => b.type === "details"),
    ).toMatchObject({
      summary: "备注",
      blocks: [{ type: "paragraph", text: "private notes" }],
    });
    expect(
      view.richMessage.blocks?.some(
        (block) => block.type === "heading" || block.type === "paragraph",
      ),
    ).toBe(false);
    expect(view.richMessage.blocks?.[0]).toMatchObject({
      type: "table",
      is_compact: true,
      is_bordered: true,
    });
    const controls = view.replyMarkup?.inline_keyboard;
    expect(controls?.map((row) => row.length)).toEqual([2, 2, 2]);
    expect(controls?.flat().map((b) => b.callback_data)).toEqual([
      "list:edit:sub-1:2",
      "list:del:sub-1:2",
      "list:pause:sub-1:2",
      "list:ef:trial:sub-1:2",
      "list:ef:autorenew:sub-1:2",
      "list:back:2",
    ]);
    expect(
      detailPresentation(sub(1)).richMessage.blocks?.some(
        (b) => b.type === "details",
      ),
    ).toBe(false);
  });
  it("uses a single-item summary and aligns sorted reminders with renewal buttons", () => {
    expect(
      reminderPresentation([sub(1)]).richMessage.blocks?.some(
        (b) => b.type === "table",
      ),
    ).toBe(false);
    const view = reminderPresentation([
      sub(1, { name: "Z", billingCycle: "custom" }),
      sub(2, { name: "A", isTrial: true }),
      sub(3, { name: "B", autoRenew: false }),
    ]);
    expect(
      view.richMessage.blocks?.find((b) => b.type === "table")?.cells,
    ).toHaveLength(4);
    expect(view.plainText.indexOf("A")).toBeLessThan(
      view.plainText.indexOf("B"),
    );
    expect(view.plainText).toContain("体验到期");
    expect(view.plainText).toContain("服务到期");
    expect(view.plainText).not.toContain("发送 /list");
    expect(view.replyMarkup?.inline_keyboard.flat().map((b) => b.text)).toEqual(
      ["已续费 · A", "已续费 · B", "管理订阅"],
    );
  });
});
