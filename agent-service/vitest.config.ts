import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const contractsIndex = fileURLToPath(new URL("../packages/agent-contracts/src/index.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@agent-contracts": contractsIndex,
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    root: rootDir,
  },
});
