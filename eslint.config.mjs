// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["eslint.config.mjs"] },
  ...tseslint.configs.strictTypeChecked,
  {
  languageOptions: {
    parserOptions: {
      project: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    // Allow void expression statements (e.g. void somePromise())
    "@typescript-eslint/no-confusing-void-expression": "off",
  },
});
