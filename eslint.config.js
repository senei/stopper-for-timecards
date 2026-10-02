import { fixupPluginRules } from "@eslint/compat";
import eslint from "@eslint/js";
import { defineConfig, includeIgnoreFile } from "eslint/config";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import eslintPluginAstro from "eslint-plugin-astro";
import pluginReact from "eslint-plugin-react";
import eslintPluginReactHooks from "eslint-plugin-react-hooks";
import path from "node:path";
import tseslint from "typescript-eslint";

// eslint-plugin-react still uses context APIs removed in ESLint 10; wrap it until it ships native support.
const reactPlugin = fixupPluginRules(pluginReact);

const gitignorePath = path.resolve(import.meta.dirname, ".gitignore");

const baseConfig = defineConfig({
  extends: [eslint.configs.recommended, tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    "no-console": "error",
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings: true,
      },
    ],
    "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
  },
});

const reactConfig = defineConfig({
  files: ["**/*.{js,jsx,ts,tsx}"],
  extends: [eslintPluginReactHooks.configs.flat["recommended-latest"]],
  plugins: { react: reactPlugin },
  languageOptions: {
    ...pluginReact.configs.flat.recommended.languageOptions,
    globals: {
      window: true,
      document: true,
    },
  },
  settings: { react: { version: "detect" } },
  rules: {
    ...pluginReact.configs.flat.recommended.rules,
    "react/react-in-jsx-scope": "off",
  },
});

const astroConfig = defineConfig({
  files: ["**/*.astro"],
  languageOptions: {
    // astro-eslint-parser does not support projectService yet and warns on every file; hand it a project path instead.
    parserOptions: { projectService: false, project: "./tsconfig.json", tsconfigRootDir: import.meta.dirname },
  },
  rules: {
    "astro/no-set-html-directive": "error",
    "astro/no-unused-css-selector": "warn",
    "astro/prefer-class-list-directive": "warn",
    // The rule crashes on the top-level `return Astro.redirect(...)` that Astro frontmatter relies on.
    "@typescript-eslint/no-misused-promises": "off",
  },
});

// An empty `catch` turns a failure into silence. Bind the error and report it with `logError` (src/lib/log.ts), which is
// also the only place allowed to write to the console.
const noSilentCatchConfig = defineConfig({
  files: ["src/**/*.{ts,tsx,astro}"],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: "CatchClause[param=null]",
        message:
          "Bind the error and report it with logError from src/lib/log.ts; a catch without a binding hides the failure.",
      },
    ],
  },
});

const loggerConfig = defineConfig({
  files: ["src/lib/log.ts"],
  rules: { "no-console": "off", "no-restricted-syntax": "off" },
});

const scriptsConfig = defineConfig({
  files: ["scripts/**/*.mjs"],
  extends: [tseslint.configs.disableTypeChecked],
  languageOptions: { globals: { console: true, process: true, fetch: true, URL: true, URLSearchParams: true } },
  rules: { "no-console": "off" },
});

export default defineConfig(
  includeIgnoreFile(gitignorePath),
  // Agent skills under .claude/ ship their own scripts and tests; they are not project code.
  { ignores: [".claude/**"] },
  baseConfig,
  reactConfig,
  eslintPluginAstro.configs["flat/recommended"],
  eslintPluginAstro.configs["flat/jsx-a11y-recommended"],
  astroConfig,
  noSilentCatchConfig,
  loggerConfig,
  scriptsConfig,
  eslintPluginPrettier,
);
