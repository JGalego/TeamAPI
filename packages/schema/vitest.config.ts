import { defineConfig } from "vitest/config";
import { sharedConfig } from "../../vitest.shared";

export default defineConfig(sharedConfig({ statements: 99, branches: 98, functions: 100, lines: 99 }));
