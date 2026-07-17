# Desktop hooks

A hook earns its own file only when it is reused or owns a real React lifecycle, such as a subscription, effect, or ref.
Otherwise, inline it at its call site. New multi-file hook internals belong in a domain directory instead of adding
more files to this root.

Only put code here when it needs React. Imperative workflows belong in `application/`, pure helpers in `lib/`,
display projections in `presentation/`, and state ownership in `store/`.

Action factories should read Zustand actions from `useAppStore.getState()` at invocation time instead of accepting
store setters as parameters. This keeps them usable from relay routing and directly testable without a renderer.

Components subscribe to the narrowest store value they render, ideally a per-room value such as
`state.codexRuntimeByRoom[roomId]`. App-level code passes only effectful capabilities that cannot live in the store. Do
not add selector bundles, view-model prop assemblers, callback-proxy layers, or compatibility re-export files;
derived selectors belong beside their store slice.
