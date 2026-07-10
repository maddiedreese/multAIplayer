# Hook boundaries

Hooks are named by domain. New multi-file hook internals belong in a domain directory instead of adding more files to this root.

- `relay/`: relay connection and decrypted-envelope routing
- `useRoom*`, `useAppRoom*`: room interaction and panels
- `useCodex*`: Codex turns, approvals, and host-local integration
- `useWorkspace*`, `useAppWorkspace*`: workspace records and flows
- `useGitHub*`, `useGitWorkflow*`: GitHub and git workflow state

Keep genuine component-tree composition hooks at this level; avoid compatibility re-export files that would leave the flat-file discovery problem unchanged.

Only put code here when it needs React: subscriptions, effects, refs, or component-tree composition. Imperative action factories belong in `lib/` and should read Zustand actions from `useAppStore.getState()` at invocation time instead of accepting store setters as parameters. This keeps them usable from relay routing and directly testable without a renderer.

Components subscribe to the narrowest store value they render, ideally a per-room value such as `state.codexRuntimeByRoom[roomId]`. App-level code passes only effectful capabilities that cannot live in the store. Do not add selector bundles, view-model prop assemblers, or callback-proxy layers; derived selectors belong beside their store slice.
