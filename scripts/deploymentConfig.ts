interface DeploymentConfig {
  vars?: Record<string, unknown>;
  d1_databases?: { binding?: string; database_id?: string }[];
  queues?: {
    producers?: { binding?: string; queue?: string }[];
    consumers?: {
      queue?: string;
      dead_letter_queue?: string;
      max_concurrency?: number;
    }[];
  };
  triggers?: { crons?: string[] };
}

export function deploymentProblems(config: DeploymentConfig): string[] {
  const problems: string[] = [];
  if (config.vars?.APP_ENV !== "production")
    problems.push("Set APP_ENV=production in wrangler.toml.");
  const database = config.d1_databases?.find(
    (item) => item.binding === "COURSE_DB",
  );
  if (
    !database?.database_id ||
    !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(database.database_id) ||
    database.database_id === "00000000-0000-0000-0000-000000000000"
  )
    problems.push(
      "Create the production D1 database and set its real COURSE_DB database_id.",
    );
  const producer = config.queues?.producers?.find(
    (item) => item.binding === "COURSE_QUEUE",
  );
  const consumer = config.queues?.consumers?.find(
    (item) => item.queue === producer?.queue,
  );
  if (!producer?.queue || !consumer)
    problems.push("Configure COURSE_QUEUE and its matching queue consumer.");
  else {
    if (
      !consumer.dead_letter_queue ||
      consumer.dead_letter_queue === producer.queue
    )
      problems.push(
        "Configure a separate dead-letter queue for delivery failures.",
      );
    if (consumer.max_concurrency !== 1)
      problems.push(
        "Keep delivery max_concurrency=1; sending is paced for a single consumer.",
      );
  }
  if (!config.triggers?.crons?.includes("* * * * *"))
    problems.push(
      "Configure the every-minute Cron trigger for scheduled delivery.",
    );
  for (const key of [
    "BOT_TOKEN",
    "TELEGRAM_WEBHOOK_SECRET",
    "ENCRYPTION_KEY",
    "USER_HASH_SECRET",
  ])
    if (config.vars && key in config.vars)
      problems.push(
        `Remove ${key} from plaintext vars; configure it as a Worker secret.`,
      );
  return problems;
}
