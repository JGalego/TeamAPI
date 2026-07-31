// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.tsbuildinfo", ".turbo/**", "coverage/**", "**/coverage/**"],
  },
  js.configs.recommended,
  // Type-aware linting. This is the half of the ruleset that can actually see across a call —
  // a promise dropped on the floor or an `any` bleeding out of a JSON parse is invisible to the
  // syntax-only rules. It needs a TypeScript program per package; tsconfig.test.json is the one
  // to point at, because it is the project that spans both `src` and the test sources.
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: ["packages/*/tsconfig.test.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Prefixing an intentionally-unused arg/var with `_` is a common, readable convention
      // (e.g. destructuring a Fastify handler's unused `_req`) — don't fight it.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],

      // `async` on a function that never awaits is usually deliberate here: it pins a return
      // type to Promise<T> so an interface stays uniform across sync and async implementations.
      // Dropping the keyword to satisfy a linter would change the signature.
      "@typescript-eslint/require-await": "off",

      // The rules worth having teeth. A floating promise is a silently swallowed failure; an
      // async callback passed where a void one is expected is the same bug one level up.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/return-await": ["error", "in-try-catch"],

      // Prefer `??`/`?.` over hand-rolled truthiness chains, which quietly treat "" and 0 as absent.
      "@typescript-eslint/prefer-nullish-coalescing": "error",
      "@typescript-eslint/prefer-optional-chain": "error",

      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-var": "error",
      "prefer-const": "error",
      "object-shorthand": ["error", "properties"],
      "no-else-return": ["error", { allowElseIf: false }],
    },
  },
  {
    // Config files are plain ESM with no TypeScript project behind them.
    files: ["**/*.mjs", "**/*.js"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // `console` is how the CLI talks to the user, so it is the one place it belongs. Everywhere
    // else a stray log is either debug residue or a library writing to someone else's stdout —
    // which, for the MCP server speaking JSON-RPC over stdio, corrupts the transport.
    files: ["packages/*/src/**/*.ts"],
    ignores: ["packages/cli/**", "**/__tests__/**", "**/*.test.ts"],
    rules: {
      "no-console": "error",
    },
  },
  {
    // Tests reach into internals and build partial fixtures on purpose. Holding them to the
    // same no-unsafe-* bar as shipped code buys nothing and makes fixtures unreadable.
    files: ["**/__tests__/**/*.ts", "**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
);
