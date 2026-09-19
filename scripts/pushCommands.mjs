import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const commands = [
  { command: "start", description: "Get started" },
  { command: "menu", description: "Open main menu" },
  { command: "add", description: "Add subscription" },
  { command: "list", description: "Manage subscriptions" },
  { command: "report", description: "View spending report" },
  { command: "reminders", description: "View reminders" },
  { command: "settings", description: "Open settings" },
  { command: "help", description: "View help" },
];

function parseDotEnv(content) {
  const values = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

function getBotToken() {
  if (process.env.BOT_TOKEN) {
    return process.env.BOT_TOKEN;
  }

  const devVarsPath = resolve(process.cwd(), ".dev.vars");

  if (!existsSync(devVarsPath)) {
    return undefined;
  }

  return parseDotEnv(readFileSync(devVarsPath, "utf8")).BOT_TOKEN;
}

const botToken = getBotToken();

if (!botToken) {
  console.error("BOT_TOKEN is required. Set it in the environment or .dev.vars.");
  process.exit(1);
}

async function callBotApi(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    console.error(`Telegram Bot API ${method} failed.`);
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }
}

// Remove the old default/global command list so group chats do not inherit it.
await callBotApi("deleteMyCommands", {
  scope: { type: "default" },
});
await callBotApi("setMyCommands", {
  commands,
  scope: { type: "all_private_chats" },
});

console.log(`Pushed ${commands.length} private-chat Telegram bot commands.`);
