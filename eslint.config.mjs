import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "dist/**",
    "node_modules/**",
    ".build/**",
    // End-to-end tests run by Adzo, with their own config and packages.
    "adzo-tests/**",
    "worker/dist/**",
    "ops/convex-forwarder/node_modules/**",
    "ops/convex-forwarder/convex/_generated/**",
    "next-env.d.ts",
  ]),
]);
