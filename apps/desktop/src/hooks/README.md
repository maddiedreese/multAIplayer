# Hook domains

Hooks remain named by domain while the app-view composition is being reduced. New multi-file hook internals belong in a domain directory instead of adding more files to this root.

- `relay/`: relay connection and decrypted-envelope routing
- `useRoom*`, `useAppRoom*`: room interaction and panels
- `useCodex*`: Codex turns, approvals, and host-local integration
- `useWorkspace*`, `useAppWorkspace*`: workspace records and flows
- `useGitHub*`, `useGitWorkflow*`: GitHub and git workflow state

Keep public composition hooks at this level until their callers can move as one unit; avoid compatibility re-export files that would leave the flat-file discovery problem unchanged.
