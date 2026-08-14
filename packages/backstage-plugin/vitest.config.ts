import { defineConfig } from "vitest/config";
import { sharedConfig } from "../../vitest.shared";

export default defineConfig(sharedConfig({ statements: 95, branches: 90, functions: 100, lines: 95 }));
