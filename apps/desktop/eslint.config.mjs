import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: [".vite/**", "out/**", "coverage/**", "eslint.config.mjs"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["test/fixtures/compiler/verify.mjs"] },
        tsconfigRootDir: import.meta.dirname
      },
      globals: { ...globals.browser, ...globals.node }
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/unbound-method": "off"
    }
  },
  {
    files: ["test/fixtures/compiler/verify.mjs"],
    extends: [tseslint.configs.disableTypeChecked]
  }
);
