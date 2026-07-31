import { defineConfig } from "vitest/config";
import { sharedConfig } from "../../vitest.shared";

export default defineConfig(sharedConfig({ statements: 81, branches: 82, functions: 100, lines: 81 }));
