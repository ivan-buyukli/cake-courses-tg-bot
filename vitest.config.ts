import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@cf-wasm/resvg/legacy/workerd",
        replacement: require.resolve("@cf-wasm/resvg/legacy/node"),
      },
    ],
  },
  plugins: [
    {
      name: "worker-binary-assets",
      enforce: "pre",
      resolveId(source) {
        if (/\.(woff|wasm)$/.test(source) && !source.startsWith("."))
          return `\0binary:${require.resolve(source)}`;
        return undefined;
      },
      load(id) {
        if (!id.startsWith("\0binary:")) return;
        const bytes = [...readFileSync(id.slice(8))];
        return id.endsWith(".wasm")
          ? `export default new WebAssembly.Module(new Uint8Array(${JSON.stringify(bytes)}));`
          : `export default new Uint8Array(${JSON.stringify(bytes)}).buffer;`;
      },
    },
  ],
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
    },
  },
});
