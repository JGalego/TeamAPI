// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.tsbuildinfo", ".turbo/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Prefixing an intentionally-unused arg/var with `_` is a common, readable convention
      // (e.g. destructuring a Fastify handler's unused `_req`) — don't fight it.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // This codebase relies on it deliberately in a few narrow spots (e.g. `LoaderRegistry` as
      // a structural interface for tests); flag as a warning to reconsider, not a hard error.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
