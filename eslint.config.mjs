import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";
import { packageBoundaryRule } from "./tools/eslint/workspace-boundaries.mjs";

const typescriptFiles = ["**/*.{ts,tsx}"];
export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/target/**", "apps/desktop/src-tauri/gen/**"]
  },
  {
    ...js.configs.recommended,
    files: ["**/*.mjs"],
    languageOptions: {
      globals: globals.node
    }
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: typescriptFiles
  })),
  {
    files: typescriptFiles,
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_"
        }
      ]
    }
  },
  {
    files: typescriptFiles,
    ignores: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
    rules: {
      complexity: ["error", 20],
      "max-depth": ["error", 5]
    }
  },
  {
    files: typescriptFiles,
    ignores: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}", "**/test/**", "**/tests/**", "e2e/**"],
    rules: {
      "max-lines": ["error", { max: 600, skipBlankLines: true, skipComments: true }]
    }
  },
  {
    files: ["apps/desktop/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      }
    }
  },
  {
    files: ["apps/desktop/src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error"
    }
  },
  {
    files: ["apps/desktop/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": packageBoundaryRule("@multaiplayer/desktop", ["@multaiplayer/protocol"])
    }
  },
  {
    files: ["apps/relay/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": packageBoundaryRule("@multaiplayer/relay", ["@multaiplayer/protocol"])
    }
  },
  {
    files: ["apps/relay/test/process-security-journey.test.ts"],
    rules: {
      "no-restricted-imports": packageBoundaryRule("@multaiplayer/relay process security journey", [
        "@multaiplayer/protocol"
      ])
    }
  },
  {
    files: ["packages/protocol/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": packageBoundaryRule("@multaiplayer/protocol")
    }
  }
);
