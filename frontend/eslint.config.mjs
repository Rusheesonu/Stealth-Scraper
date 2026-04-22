// Minimal flat config that works with ESLint 9 + Next 16 without
// tripping the FlatCompat circular-reference bug. We rely on `next build`
// for correctness checks (it runs its own TS + SWC validation) and use
// ESLint only for basic hygiene.

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  { ignores: [".next/**", "node_modules/**", "out/**", "*.tsbuildinfo"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
];
