import { defineConfig } from "vitest/config";
import { sharedConfig } from "../../vitest.shared";

export default defineConfig(sharedConfig({ statements: 94, branches: 90, functions: 89, lines: 94 }));
