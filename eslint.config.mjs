import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const typescriptFiles = ["**/*.{ts,tsx}"];
const workspacePackages = [
  "@multaiplayer/codex",
  "@multaiplayer/desktop",
  "@multaiplayer/git",
  "@multaiplayer/github",
  "@multaiplayer/protocol",
  "@multaiplayer/relay"
];
const relativeWorkspaceSourcePattern =
  "^(?:\\.\\./)+(?:apps/(?:desktop|relay)|packages/(?:codex|git|github|protocol)|(?:desktop|relay|codex|git|github|protocol))(?:/|$)";

const zustandStateOwners = {
  relayHttpDraft: "appConfigSlice",
  relayWsDraft: "appConfigSlice",
  browserByRoom: "browserSlice",
  chatDeletesByRoom: "workspaceDataSlice",
  chatEditsByRoom: "workspaceDataSlice",
  codexRuntimeByRoom: "codexHostHandoffSlice",
  filePanelByRoom: "filePanelSlice",
  gitWorkflowRuntimeByRoom: "gitWorkflowSlice",
  historyPresenceByRoom: "historyPresenceSlice",
  teamHistoryByTeam: "historyPresenceSlice",
  inviteByRoom: "inviteSlice",
  localPreviewByRoom: "localPreviewSlice",
  localPreviewDialog: "localPreviewSlice",
  messagesByRoom: "workspaceDataSlice",
  roomChatByRoom: "roomChatSlice",
  roomSettingsByRoom: "roomSettingsSlice",
  sensitiveAttachmentReviewKey: "roomChatSlice",
  teamRosterByTeam: "workspaceDataSlice",
  terminalRuntimeByRoom: "terminalSlice",
  terminals: "terminalSlice",
  trustedDeviceKeys: "appRuntimeSlice",
  trustedDeviceKeysLoaded: "appRuntimeSlice",
  forgottenRoomIds: "relayRuntimeSlice",
  revokedRoomIds: "relayRuntimeSlice",
  revokedTeamIds: "relayRuntimeSlice",
  inspectorCollapsed: "shellSlice",
  sidebarCollapsed: "shellSlice",
  themeMode: "shellSlice",
  rooms: "workspaceUiSlice",
  selectedRoomId: "workspaceUiSlice",
  selectedTeam: "workspaceUiSlice",
  teams: "workspaceUiSlice",
  workspaceUiInitialized: "workspaceUiSlice"
};

const allowedZustandDependencies = {
  roomLifecycleSlice: new Set([
    "browserSlice",
    "codexHostHandoffSlice",
    "filePanelSlice",
    "gitWorkflowSlice",
    "historyPresenceSlice",
    "inviteSlice",
    "localPreviewSlice",
    "roomChatSlice",
    "roomSettingsSlice",
    "terminalSlice",
    "workspaceDataSlice"
  ]),
  workspaceDataSlice: new Set(["codexHostHandoffSlice"])
};

function desktopZustandSliceBoundaryRule() {
  return {
    meta: {
      type: "problem",
      schema: [],
      messages: {
        forbidden:
          "{{slice}} accesses {{property}}, which is owned by {{owner}}. Document and allow intentional cross-slice dependencies.",
        unregistered:
          "{{slice}} accesses unregistered state property {{property}}. Register its owner before adding the state dependency."
      }
    },
    create(context) {
      const filename = context.filename.replaceAll("\\", "/");
      const match = filename.match(/\/store\/slices\/([^/]+)\.ts$/);
      if (!match) return {};
      const slice = match[1];
      function checkProperty(node, property) {
        const owner = zustandStateOwners[property];
        if (!owner) {
          context.report({ node, messageId: "unregistered", data: { slice, property } });
          return;
        }
        if (owner === slice || allowedZustandDependencies[slice]?.has(owner)) return;
        context.report({ node, messageId: "forbidden", data: { slice, property, owner } });
      }
      function isGetCall(node) {
        return node?.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "get";
      }
      return {
        MemberExpression(node) {
          const readsStore =
            (node.object.type === "Identifier" && node.object.name === "state") || isGetCall(node.object);
          if (!readsStore) return;
          const property =
            !node.computed && node.property.type === "Identifier"
              ? node.property.name
              : node.computed && node.property.type === "Literal" && typeof node.property.value === "string"
                ? node.property.value
                : null;
          if (property) checkProperty(node.property, property);
        },
        VariableDeclarator(node) {
          if (node.id.type !== "ObjectPattern" || !isGetCall(node.init)) return;
          for (const propertyNode of node.id.properties) {
            if (propertyNode.type !== "Property") continue;
            const property =
              propertyNode.key.type === "Identifier"
                ? propertyNode.key.name
                : typeof propertyNode.key.value === "string"
                  ? propertyNode.key.value
                  : null;
            if (property) checkProperty(propertyNode.key, property);
          }
        }
      };
    }
  };
}

function desktopBareCatchRule() {
  const reportingCalls = new Set(["recordDiagnosticEvent", "reportExpectedFailure", "reportNonFatal"]);
  function observesFailure(node) {
    if (node.type === "ThrowStatement") return true;
    if (node.type === "CallExpression") {
      if (node.callee.type === "Identifier" && reportingCalls.has(node.callee.name)) return true;
      if (
        node.callee.type === "Identifier" &&
        (node.callee.name === "set" || /^(?:set|replace)[A-Z]/.test(node.callee.name))
      )
        return true;
      if (
        node.callee.type === "MemberExpression" &&
        !node.callee.computed &&
        node.callee.property.type === "Identifier" &&
        /^(?:set|replace)[A-Z]/.test(node.callee.property.name)
      )
        return true;
      if (
        node.callee.type === "MemberExpression" &&
        node.callee.object.type === "Identifier" &&
        node.callee.object.name === "console" &&
        node.callee.property.type === "Identifier" &&
        ["debug", "warn", "error"].includes(node.callee.property.name)
      )
        return true;
    }
    return Object.entries(node).some(([key, value]) => {
      if (key === "parent") return false;
      if (Array.isArray(value))
        return value.some((item) => item && typeof item.type === "string" && observesFailure(item));
      return Boolean(value && typeof value.type === "string" && observesFailure(value));
    });
  }
  return {
    meta: {
      type: "problem",
      schema: [],
      messages: {
        unreported:
          "A catch without an error binding must report an expected/non-fatal failure, log at debug level or above, or rethrow."
      }
    },
    create(context) {
      return {
        CatchClause(node) {
          if (observesFailure(node.body)) return;
          if (node.param?.type === "Identifier" && failureIsPropagated(node.body, node.param.name)) return;
          context.report({ node, messageId: "unreported" });
        },
        CallExpression(node) {
          if (
            node.callee.type !== "MemberExpression" ||
            node.callee.computed ||
            node.callee.property.type !== "Identifier" ||
            node.callee.property.name !== "catch"
          )
            return;
          const callback = node.arguments[0];
          if (!callback || (callback.type !== "ArrowFunctionExpression" && callback.type !== "FunctionExpression"))
            return;
          if (observesFailure(callback.body)) return;
          const errorParameter = callback.params[0];
          if (
            errorParameter?.type === "Identifier" &&
            callback.body.type === "BlockStatement" &&
            failureIsPropagated(callback.body, errorParameter.name)
          )
            return;
          if (
            errorParameter?.type === "Identifier" &&
            callback.body.type !== "BlockStatement" &&
            expressionContainsIdentifier(callback.body, errorParameter.name)
          )
            return;
          context.report({ node: callback, messageId: "unreported" });
        }
      };
    }
  };
}

function expressionContainsIdentifier(node, name) {
  if (node.type === "Identifier") return node.name === name;
  return Object.entries(node).some(([key, value]) => {
    if (key === "parent") return false;
    if (Array.isArray(value))
      return value.some((item) => item && typeof item.type === "string" && expressionContainsIdentifier(item, name));
    return Boolean(value && typeof value.type === "string" && expressionContainsIdentifier(value, name));
  });
}

function failureIsPropagated(node, name) {
  if (node.type === "ReturnStatement" && node.argument && expressionContainsIdentifier(node.argument, name))
    return true;
  if (
    node.type === "CallExpression" &&
    node.arguments.some((argument) => argument.type !== "SpreadElement" && expressionContainsIdentifier(argument, name))
  )
    return true;
  return Object.entries(node).some(([key, value]) => {
    if (key === "parent") return false;
    if (Array.isArray(value))
      return value.some((item) => item && typeof item.type === "string" && failureIsPropagated(item, name));
    return Boolean(value && typeof value.type === "string" && failureIsPropagated(value, name));
  });
}

const desktopArchitecturePlugin = {
  rules: {
    "zustand-slice-boundaries": desktopZustandSliceBoundaryRule(),
    "no-unreported-bare-catch": desktopBareCatchRule()
  }
};

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
