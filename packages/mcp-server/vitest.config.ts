import { defineConfig } from "vitest/config";
import { sharedConfig } from "../../vitest.shared";

export default defineConfig(sharedConfig({ statements: 94, branches: 80, functions: 100, lines: 94 }));
