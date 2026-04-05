import tseslint from "typescript-eslint";

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    rules: {
      // Completions are snippets — not exporting a symbol is not an error
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
);
