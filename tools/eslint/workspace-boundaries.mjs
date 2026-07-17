const workspacePackages = ["@multaiplayer/desktop", "@multaiplayer/protocol", "@multaiplayer/relay"];
const relativeWorkspaceSourcePattern = "^(?:\\.\\./)+(?:apps/(?:desktop|relay)|packages/(?:codex|protocol))(?:/|$)";
export function packageBoundaryRule(workspaceName, dependencies = []) {
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
