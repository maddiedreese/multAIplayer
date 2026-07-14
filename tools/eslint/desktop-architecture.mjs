import { allowedZustandDependencies, zustandStateOwners } from "../../apps/desktop/src/store/zustandStateOwnership.mjs";

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
    "zustand-slice-boundaries": desktopZustandSliceBoundaryRule(),
    "no-unreported-bare-catch": desktopBareCatchRule()
  }
};
