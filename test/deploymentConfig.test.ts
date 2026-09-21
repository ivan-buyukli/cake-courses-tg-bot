import { deploymentProblems } from "../scripts/deploymentConfig.js";

function configured() {
  return {
    vars: { APP_ENV: "production" },
    d1_databases: [
      {
        binding: "COURSE_DB",
        database_id: "11111111-2222-4333-8444-555555555555",
      },
    ],
    queues: {
      producers: [{ binding: "COURSE_QUEUE", queue: "deliveries" }],
      consumers: [
        {
          queue: "deliveries",
          dead_letter_queue: "failed-deliveries",
          max_concurrency: 1,
        },
      ],
    },
    triggers: { crons: ["* * * * *"] },
  };
}

describe("deployment configuration guard", () => {
  it("accepts a provisionable production configuration", () => {
    expect(deploymentProblems(configured())).toEqual([]);
  });
  it("rejects placeholder databases, development mode and missing infrastructure", () => {
    const config = configured();
    config.vars.APP_ENV = "development";
    config.d1_databases[0]!.database_id =
      "00000000-0000-0000-0000-000000000000";
    config.queues.consumers = [];
    config.triggers.crons = [];
    expect(deploymentProblems(config)).toHaveLength(4);
    expect(deploymentProblems({})).toHaveLength(4);
  });
  it("protects delivery pacing and requires a distinct dead-letter queue", () => {
    const config = configured();
    config.queues.consumers[0]!.max_concurrency = 10;
    config.queues.consumers[0]!.dead_letter_queue = "deliveries";
    expect(deploymentProblems(config)).toHaveLength(2);
  });
  it("rejects plaintext credentials without returning their values", () => {
    const config = configured();
    Object.assign(config.vars, { BOT_TOKEN: "sensitive_test_value" });
    const problems = deploymentProblems(config);
    expect(problems).toHaveLength(1);
    expect(problems.join()).not.toContain("sensitive_test_value");
  });
});
