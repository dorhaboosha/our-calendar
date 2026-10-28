import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const serverOnlyStub = fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url));

export default defineConfig({
  resolve: {
    // "@/..." imports, from tsconfig.json.
    tsconfigPaths: true,
    // "server-only" throws outside React Server Components; tests run in plain Node.
    alias: { "server-only": serverOnlyStub },
  },
  test: {
    projects: [
      {
        // Fast tests with no database, next to the code they test.
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        // Tests against the our_calendar_test database (npm run db:up first).
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/integration/global-setup.ts"],
          setupFiles: ["tests/integration/setup.ts"],
          // Files share one database, so run them one at a time.
          fileParallelism: false,
        },
      },
    ],
  },
});
