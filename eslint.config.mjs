import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const typescriptFiles = ["**/*.{ts,tsx}"];
const workspacePackages = [
  "@multaiplayer/codex",
  "@multaiplayer/crypto",
  "@multaiplayer/desktop",
  "@multaiplayer/git",
  "@multaiplayer/github",
  "@multaiplayer/protocol",
  "@multaiplayer/relay"
];
const relativeWorkspaceSourcePattern =
  "^(?:\\.\\./)+(?:apps/(?:desktop|relay)|packages/(?:codex|crypto|git|github|protocol)|(?:desktop|relay|codex|crypto|git|github|protocol))(?:/|$)";

function packageBoundaryRule(workspaceName, dependencies = []) {
  const dependencySet = new Set(dependencies);
  const forbiddenPackages = workspacePackages.filter((packageName) => !dependencySet.has(packageName));

  return [
    "error",
    {
      paths: forbiddenPackages.map((packageName) => ({
        name: packageName,
        message: `${workspaceName} does not depend on ${packageName}. Add an intentional package boundary before importing it.`
      })),
      patterns: [
        {
          group: workspacePackages.map((packageName) => `${packageName}/*`),
          message: "Import from a workspace package's public entry point instead of reaching into its internals."
        },
        {
          regex: relativeWorkspaceSourcePattern,
          message: "Import workspace dependencies by package name instead of reaching across workspace source trees."
        }
      ]
    }
  ];
}

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
      "react-hooks": reactHooks
    },
    rules: {
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
    files: ["apps/desktop/src/hooks/relay/routeRelayEnvelope.ts"],
    rules: {
      "max-lines": ["error", { max: 100, skipBlankLines: true, skipComments: true }]
    }
  },
  {
    files: [
      "apps/desktop/src/hooks/relay/routeActivityEnvelope.ts",
      "apps/desktop/src/hooks/relay/routeChatEnvelope.ts",
      "apps/desktop/src/hooks/relay/routeRoomEnvelope.ts"
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
        "@multaiplayer/crypto",
        "@multaiplayer/git",
        "@multaiplayer/github",
        "@multaiplayer/protocol"
      ])
    }
  },
  {
    files: ["apps/desktop/test/scriptedSecurityJourney.test.ts"],
    rules: {
      "no-restricted-imports": packageBoundaryRule("@multaiplayer/desktop security journey", [
        "@multaiplayer/codex",
        "@multaiplayer/crypto",
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
        "@multaiplayer/crypto",
        "@multaiplayer/github",
        "@multaiplayer/protocol"
      ])
    }
  },
  {
    files: ["packages/crypto/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": packageBoundaryRule("@multaiplayer/crypto", ["@multaiplayer/protocol"])
    }
  },
  ...["codex", "git", "github", "protocol"].map((packageName) => ({
    files: [`packages/${packageName}/**/*.{ts,tsx}`],
    rules: {
      "no-restricted-imports": packageBoundaryRule(`@multaiplayer/${packageName}`)
    }
  }))
);
