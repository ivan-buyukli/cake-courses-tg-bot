import { deploymentProblems } from "./deploymentConfig.ts";
import process from "node:process";
import console from "node:console";

process.env.WRANGLER_SEND_METRICS = "false";
try {
  const { unstable_readConfig } = await import("wrangler");
  const config = unstable_readConfig(
    { config: "wrangler.toml" },
    { hideWarnings: true },
  );
  const problems = deploymentProblems(config);
  if (problems.length) {
    console.error("Deployment configuration needs attention:");
    for (const problem of problems) console.error(`- ${problem}`);
    process.exitCode = 1;
  } else {
    console.log("Local deployment configuration passed.");
    console.log(
      "Still verify Cloudflare resources, remote migrations, production secrets and the Telegram webhook. See docs/deployment.md.",
    );
  }
} catch {
  console.error(
    "Cannot validate wrangler.toml. No configuration values were logged.",
  );
  process.exitCode = 1;
}
