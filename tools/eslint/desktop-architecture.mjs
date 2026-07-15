import { allowedZustandDependencies, zustandStateOwners } from "../../apps/desktop/src/store/zustandStateOwnership.mjs";

const desktopLibDomainDependencies = Object.freeze({
  access: new Set(),
  browser: new Set(["access", "codex", "core"]),
  chat: new Set(),
  codex: new Set(["access", "core", "platform", "security"]),
  core: new Set(),
  files: new Set(["core", "platform", "security", "terminal"]),
  formatting: new Set(["identity"]),
  git: new Set(["core", "identity"]),
  handoff: new Set(["mls", "workspace"]),
  history: new Set(["chat", "codex", "core", "identity", "mls", "platform", "terminal"]),
  identity: new Set(["core", "mls", "platform"]),
  invite: new Set(["access", "core", "mls", "platform", "room"]),
  mls: new Set(["core", "platform", "relay"]),
  onboarding: new Set(["core", "invite"]),
  platform: new Set(["core"]),
  relay: new Set(),
  room: new Set(["browser", "core"]),
  security: new Set(["core"]),
  team: new Set(["browser", "core", "workspace"]),
  terminal: new Set(["access", "platform"]),
  workspace: new Set()
});

function assertAcyclicDomainDependencies(dependencies) {
  const visiting = new Set();
  const visited = new Set();
  function visit(domain) {
    if (visited.has(domain)) return;
    if (visiting.has(domain)) throw new Error(`Desktop library domain dependency cycle includes ${domain}.`);
    visiting.add(domain);
    for (const dependency of dependencies[domain]) {
      if (!dependencies[dependency]) throw new Error(`Unknown desktop library domain dependency: ${dependency}.`);
      visit(dependency);
    }
    visiting.delete(domain);
    visited.add(domain);
  }
  for (const domain of Object.keys(dependencies)) visit(domain);
}

assertAcyclicDomainDependencies(desktopLibDomainDependencies);

function normalizedPath(value) {
  const segments = [];
  for (const segment of value.replaceAll("\\", "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return `${value.startsWith("/") ? "/" : ""}${segments.join("/")}`;
}

function parentPath(value) {
  return value.slice(0, value.lastIndexOf("/"));
}

function desktopSourcePath(filename, specifier) {
  const normalizedFilename = normalizedPath(filename);
  if (specifier.startsWith("@/")) {
    const marker = "/apps/desktop/src/";
    const rootIndex = normalizedFilename.indexOf(marker);
    if (rootIndex < 0) return null;
    return `${normalizedFilename.slice(0, rootIndex + marker.length)}${specifier.slice(2)}`;
  }
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
  return normalizedPath(`${parentPath(normalizedFilename)}/${specifier}`);
}

function desktopLayer(value) {
  const marker = "/apps/desktop/src/";
  const markerIndex = value.indexOf(marker);
  if (markerIndex < 0) return null;
  const segments = value.slice(markerIndex + marker.length).split("/");
  if (segments[0] === "lib") return { kind: "lib", domain: segments[1] ?? null, depth: segments.length };
  return { kind: segments[0], domain: null, depth: segments.length };
}

function literalModuleSpecifier(node) {
  return node?.type === "Literal" && typeof node.value === "string" ? node.value : null;
}

function desktopNoFlatLibModuleRule() {
  return {
    meta: {
      type: "problem",
      schema: [],
      messages: {
        flat: "Desktop library modules must live in a named domain directory under src/lib/.",
        unknown: "Desktop library modules must use a reviewed domain from the dependency table."
      }
    },
    create(context) {
      const layer = desktopLayer(normalizedPath(context.filename));
      if (layer?.kind !== "lib") return {};
      return {
        Program(node) {
          if (layer.depth === 2) context.report({ node, messageId: "flat" });
          else if (!desktopLibDomainDependencies[layer.domain]) context.report({ node, messageId: "unknown" });
        }
      };
    }
  };
}

function desktopLayerBoundaryRule() {
  return {
    meta: {
      type: "problem",
      schema: [],
      messages: {
        domain: "The {{source}} library domain may not import the {{target}} domain.",
        layer: "The {{source}} layer may not import the {{target}} layer.",
        flatTarget: "Imports may not target a flat module directly under src/lib/."
      }
    },
    create(context) {
      const sourcePath = normalizedPath(context.filename);
      const source = desktopLayer(sourcePath);
      if (!source || !["lib", "application", "presentation"].includes(source.kind)) return {};

      function check(node, specifier) {
        const targetPath = desktopSourcePath(sourcePath, specifier);
        if (!targetPath) return;
        const target = desktopLayer(targetPath);
        if (!target) return;
        if (target.kind === "lib" && target.depth === 2) {
          context.report({ node, messageId: "flatTarget" });
          return;
        }
        if (source.kind === "lib") {
          if (target.kind !== "lib" && target.kind !== "types" && target.kind !== "types.ts") {
            context.report({ node, messageId: "layer", data: { source: "lib", target: target.kind } });
            return;
          }
          if (target.kind !== "lib" || source.domain === target.domain) return;
          const allowed = desktopLibDomainDependencies[source.domain];
          if (!allowed?.has(target.domain)) {
            context.report({ node, messageId: "domain", data: { source: source.domain, target: target.domain } });
          }
          return;
        }
        if (source.kind === "application" && ["components", "hooks", "presentation"].includes(target.kind)) {
          context.report({ node, messageId: "layer", data: { source: "application", target: target.kind } });
          return;
        }
        if (source.kind === "presentation" && ["hooks", "store"].includes(target.kind)) {
          context.report({ node, messageId: "layer", data: { source: "presentation", target: target.kind } });
        }
      }

      return {
        ImportDeclaration(node) {
          const specifier = literalModuleSpecifier(node.source);
          if (specifier) check(node.source, specifier);
        },
        ExportNamedDeclaration(node) {
          const specifier = literalModuleSpecifier(node.source);
          if (specifier) check(node.source, specifier);
        },
        ExportAllDeclaration(node) {
          const specifier = literalModuleSpecifier(node.source);
          if (specifier) check(node.source, specifier);
        },
        ImportExpression(node) {
          const specifier = literalModuleSpecifier(node.source);
          if (specifier) check(node.source, specifier);
        }
      };
    }
  };
}

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

export const desktopArchitecturePlugin = {
  rules: {
    "layer-boundaries": desktopLayerBoundaryRule(),
    "no-flat-lib-module": desktopNoFlatLibModuleRule(),
    "zustand-slice-boundaries": desktopZustandSliceBoundaryRule(),
    "no-unreported-bare-catch": desktopBareCatchRule()
  }
};
