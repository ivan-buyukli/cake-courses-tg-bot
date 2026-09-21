import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { catalogs, detectLocale } from "../src/bot/i18n.ts";

const local = existsSync(".dev.vars") ? parseEnv(readFileSync(".dev.vars", "utf8")) : {};
const token = process.env.BOT_TOKEN ?? local.BOT_TOKEN;
if (!token) throw new Error("BOT_TOKEN is required");
const keys = {
  start: "mainMenu", buy: "buy", my_course: "myCourse",
  language: "language", stop: "stop", resume: "resume", help: "mainMenu",
};
async function call(method, body) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error("Rejected");
  } catch {
    throw new Error(`Telegram ${method} failed; no credentials or API payload logged`);
  }
}
for (const language of ["", "en", "uk"]) {
  const catalog = catalogs[detectLocale(language)];
  await call("deleteMyCommands", { scope: { type: "default" }, language_code: language });
  await call("setMyCommands", {
    commands: Object.entries(keys).map(([command, key]) => ({ command, description: catalog[key] })),
    scope: { type: "all_private_chats" }, language_code: language,
  });
}
for (const type of ["default", "all_private_chats"]) {
  await call("deleteMyCommands", { scope: { type }, language_code: "pl" });
}
console.log("Updated English and Ukrainian menus; removed the old Polish menus.");
