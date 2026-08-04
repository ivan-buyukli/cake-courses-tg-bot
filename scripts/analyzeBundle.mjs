import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const KIB = 1024;
const MIB = 1024 * KIB;
const GZIP_BUDGET_BYTES = 2 * MIB;
const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SHOULD_CHECK = process.argv.includes("--check");

const outputDirectory = mkdtempSync(join(tmpdir(), "subscription-bot-bundle-"));
const wranglerExecutable = join(
  PROJECT_ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "wrangler.cmd" : "wrangler",
);
const metafilePath = join(outputDirectory, "bundle-meta.json");

try {
  const result = spawnSync(
    wranglerExecutable,
    [
      "deploy",
      "--dry-run",
      "--outdir",
      outputDirectory,
      "--metafile",
      metafilePath,
    ],
    {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        WRANGLER_LOG_PATH: join(outputDirectory, "wrangler.log"),
        WRANGLER_SEND_METRICS: "false",
      },
      maxBuffer: 10 * MIB,
    },
  );

  const wranglerOutput = stripAnsi(
    `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `Wrangler dry-run failed with exit code ${result.status}.\n${wranglerOutput.trim()}`,
    );
  }

  const uploadSize = parseUploadSize(wranglerOutput);
  const metafile = JSON.parse(readFileSync(metafilePath, "utf8"));
  const jsOutput = findJavaScriptOutput(metafile);
  const packageRows = packageContributions(jsOutput);
  const artifactRows = artifactContributions(outputDirectory);

  console.log("Worker bundle summary");
  console.log(`  Total upload: ${formatBytes(uploadSize.rawBytes)}`);
  console.log(`  Gzip upload:  ${formatBytes(uploadSize.gzipBytes)}`);
  console.log(
    `  Gzip budget:  ${formatBytes(GZIP_BUDGET_BYTES)} (${formatPercent(
      uploadSize.gzipBytes,
      GZIP_BUDGET_BYTES,
    )} used)`,
  );
  console.log("");
  console.log(
    "JavaScript input contributions (uncompressed; shared gzip cannot be attributed per package)",
  );
  printTable(
    ["Package", "Bytes", "Share"],
    packageRows.map(({ name, bytes }) => [
      name,
      formatBytes(bytes),
      formatPercent(bytes, jsOutput.bytes),
    ]),
  );
  console.log("");
  console.log("Bundled artifacts (local gzip -9 measurement)");
  printTable(
    ["Artifact type", "Raw", "Gzip"],
    artifactRows.map(({ name, rawBytes, gzipBytes }) => [
      name,
      formatBytes(rawBytes),
      formatBytes(gzipBytes),
    ]),
  );

  if (SHOULD_CHECK && uploadSize.gzipBytes > GZIP_BUDGET_BYTES) {
    console.error(
      `\nBundle budget exceeded: ${formatBytes(
        uploadSize.gzipBytes,
      )} is above ${formatBytes(GZIP_BUDGET_BYTES)}.`,
    );
    process.exitCode = 1;
  } else if (SHOULD_CHECK) {
    console.log(
      `\nBundle budget passed with ${formatBytes(
        GZIP_BUDGET_BYTES - uploadSize.gzipBytes,
      )} remaining.`,
    );
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : `Bundle analysis failed: ${error}`,
  );
  process.exitCode = 1;
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function parseUploadSize(output) {
  const match = output.match(
    /Total Upload:\s+([\d.]+)\s+(B|KiB|MiB)\s+\/\s+gzip:\s+([\d.]+)\s+(B|KiB|MiB)/,
  );

  if (!match) {
    throw new Error(`Could not parse Wrangler upload size.\n${output.trim()}`);
  }

  return {
    rawBytes: toBytes(Number(match[1]), match[2]),
    gzipBytes: toBytes(Number(match[3]), match[4]),
  };
}

function toBytes(value, unit) {
  if (unit === "MiB") return Math.round(value * MIB);
  if (unit === "KiB") return Math.round(value * KIB);
  return Math.round(value);
}

function findJavaScriptOutput(metafile) {
  const entry = Object.entries(metafile.outputs).find(
    ([path, output]) =>
      path.endsWith("index.js") &&
      output.inputs &&
      Object.keys(output.inputs).length > 0,
  );

  if (!entry) {
    throw new Error(
      "Could not find the bundled index.js in the esbuild metafile.",
    );
  }

  return entry[1];
}

function packageContributions(jsOutput) {
  const totals = new Map();

  for (const [inputPath, contribution] of Object.entries(jsOutput.inputs)) {
    const packageName = packageNameForInput(inputPath);
    totals.set(
      packageName,
      (totals.get(packageName) ?? 0) + contribution.bytesInOutput,
    );
  }

  return Array.from(totals, ([name, bytes]) => ({ name, bytes })).sort(
    (left, right) => right.bytes - left.bytes,
  );
}

function packageNameForInput(inputPath) {
  const normalized = inputPath.replaceAll("\\", "/");

  if (normalized.startsWith("src/")) {
    return "project:src";
  }

  const nodeModulesIndex = normalized.lastIndexOf("node_modules/");
  if (nodeModulesIndex === -1) {
    return "other";
  }

  const packageParts = normalized
    .slice(nodeModulesIndex + "node_modules/".length)
    .split("/");
  return packageParts[0].startsWith("@")
    ? packageParts.slice(0, 2).join("/")
    : packageParts[0];
}

function artifactContributions(directory) {
  const totals = new Map();

  for (const filePath of listFiles(directory)) {
    const name = relative(directory, filePath);
    if (
      name === "bundle-meta.json" ||
      name === "README.md" ||
      name.endsWith(".map") ||
      name.endsWith(".log")
    ) {
      continue;
    }

    const contents = readFileSync(filePath);
    const artifactType = artifactTypeForPath(filePath);
    const current = totals.get(artifactType) ?? {
      name: artifactType,
      rawBytes: 0,
      gzipBytes: 0,
    };
    current.rawBytes += contents.byteLength;
    current.gzipBytes += gzipSync(contents, { level: 9 }).byteLength;
    totals.set(artifactType, current);
  }

  return Array.from(totals.values()).sort(
    (left, right) => right.rawBytes - left.rawBytes,
  );
}

function listFiles(directory) {
  const files = [];

  for (const entry of readdirSync(directory)) {
    const entryPath = join(directory, entry);
    if (statSync(entryPath).isDirectory()) {
      files.push(...listFiles(entryPath));
    } else {
      files.push(entryPath);
    }
  }

  return files;
}

function artifactTypeForPath(filePath) {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".js") return "JavaScript";
  if (extension === ".wasm") return "WebAssembly";
  if (extension === ".woff") return "WOFF fonts";
  if (extension === ".woff2") return "WOFF2 fonts";
  return extension ? `Other (${extension})` : "Other";
}

function formatBytes(bytes) {
  if (bytes >= MIB) return `${(bytes / MIB).toFixed(2)} MiB`;
  if (bytes >= KIB) return `${(bytes / KIB).toFixed(2)} KiB`;
  return `${bytes} B`;
}

function formatPercent(value, total) {
  return `${((value / total) * 100).toFixed(1)}%`;
}

function printTable(headers, rows) {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length)),
  );
  const formatRow = (row) =>
    row
      .map((value, index) =>
        index === 0
          ? value.padEnd(widths[index])
          : value.padStart(widths[index]),
      )
      .join("  ");

  console.log(formatRow(headers));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) {
    console.log(formatRow(row));
  }
}
