import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    // Spike folders are throwaway by definition and excluded from quality gates.
    // Plugin assemble/validate scripts are plain Node ESM (not in the TS project).
    ignores: ["spikes/**", "**/dist/**", "**/node_modules/**", "packages/plugin/scripts/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // JS config files at the root are not part of the TS project.
    files: ["*.js", "*.mjs", "*.config.js", "*.config.ts"],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
