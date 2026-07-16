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

function noUnreportedCatchRule() {
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
        unreported: "A caught failure must be reported, reflected in state, logged, or rethrown."
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

export const desktopErrorHandlingPlugin = {
  rules: { "no-unreported-bare-catch": noUnreportedCatchRule() }
};
