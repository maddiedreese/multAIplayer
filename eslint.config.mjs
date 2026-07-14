import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";
import { desktopArchitecturePlugin } from "./tools/eslint/desktop-architecture.mjs";
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
      desktop: desktopArchitecturePlugin,
      "react-hooks": reactHooks
    },
    rules: {
      "desktop/no-unreported-bare-catch": "error",
      "desktop/zustand-slice-boundaries": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error"
    }
  },
  {
    files: ["apps/desktop/src/hooks/**/*.{ts,tsx}", "apps/desktop/src/lib/**/*.{ts,tsx}"],
    ignores: ["apps/desktop/src/**/*.test.{ts,tsx}", "apps/desktop/src/**/*.spec.{ts,tsx}"],
    rules: {
      "max-lines": ["error", { max: 575, skipBlankLines: true, skipComments: true }]
    }
  },
  {
    files: ["apps/desktop/src/hooks/useRoomInspectorComposition.tsx"],
    rules: {
      "max-lines": ["error", { max: 350, skipBlankLines: true, skipComments: true }]
    }
  },
  {
    files: ["apps/relay/src/http/rooms.ts"],
    rules: {
      "max-lines": ["error", { max: 50, skipBlankLines: true, skipComments: true }]
    }
  },
  {
    files: ["apps/relay/src/http/room-*-route.ts"],
    rules: {
      "max-lines": ["error", { max: 225, skipBlankLines: true, skipComments: true }]
    }
  },
  {
    files: ["apps/desktop/src/hooks/useCodexTurnActions.ts"],
    rules: {
      "max-lines": ["error", { max: 380, skipBlankLines: true, skipComments: true }]
    }
  },
  {
    files: ["apps/desktop/src/hooks/useHostHandoffActions.ts"],
    rules: {
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }]
    }
  },
  {
    files: ["apps/desktop/src/hooks/relay/routeMlsMessage.ts"],
    rules: {
      "max-lines": ["error", { max: 100, skipBlankLines: true, skipComments: true }]
    }
  },
  {
    files: [
      "apps/desktop/src/hooks/relay/routeActivityMessage.ts",
      "apps/desktop/src/hooks/relay/routeChatMessage.ts",
      "apps/desktop/src/hooks/relay/routeRoomMessage.ts"
    ],
    rules: {
      "max-lines": ["error", { max: 200, skipBlankLines: true, skipComments: true }]
    }
  },
  {
    files: ["apps/desktop/src/lib/roomSettingsActions.ts"],
    rules: {
      "max-lines": ["error", { max: 50, skipBlankLines: true, skipComments: true }]
    }
  },
  {
    files: ["apps/desktop/src/lib/roomSettingsActionsImpl.ts"],
    rules: {
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }]
    }
  },
  {
    files: ["apps/desktop/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": packageBoundaryRule("@multaiplayer/desktop", [
        "@multaiplayer/git",
        "@multaiplayer/github",
        "@multaiplayer/protocol"
      ])
    }
  },
  {
    files: ["apps/relay/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": packageBoundaryRule("@multaiplayer/relay", [
        "@multaiplayer/github",
        "@multaiplayer/protocol"
      ])
    }
  },
  {
    files: ["apps/relay/test/process-security-journey.test.ts"],
    rules: {
      "no-restricted-imports": packageBoundaryRule("@multaiplayer/relay process security journey", [
        "@multaiplayer/github",
        "@multaiplayer/protocol"
      ])
    }
  },
  ...["codex", "git", "github", "protocol"].map((packageName) => ({
    files: [`packages/${packageName}/**/*.{ts,tsx}`],
    rules: {
      "no-restricted-imports": packageBoundaryRule(`@multaiplayer/${packageName}`)
    }
  }))
);
