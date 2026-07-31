import type { UserConfig } from "vitest/config";

/**
 * Per-package coverage floors, expressed as percentages.
 *
 * These are set at each package's measured coverage at the time the gate was introduced, rounded
 * down to the nearest whole percent. That makes them a ratchet rather than an aspiration: they
 * cannot be met by writing no tests, and a change that removes coverage fails CI instead of
 * quietly eroding it. Raise a number when a package earns it; lowering one should need a reason
 * in the commit message.
 */
export interface CoverageFloors {
  statements: number;
  branches: number;
  functions: number;
  lines: number;
}

/**
 * The vitest config every package shares. Only the coverage floors differ, because the packages
 * genuinely differ in how testable they are — `cli` is mostly process wiring and sits lower than
 * `schema`, which is pure data.
 */
export function sharedConfig(thresholds: CoverageFloors): UserConfig {
  return {
    test: {
      coverage: {
        provider: "v8",
        reporter: ["text-summary", "lcov"],
        // Measure the shipped sources only. Including the tests in the denominator inflates the
        // number — test files are executed by definition — and hides gaps in the real code.
        include: ["src/**/*.ts"],
        exclude: ["src/**/__tests__/**", "src/**/*.test.ts", "src/index.ts"],
        thresholds,
      },
    },
  };
}
