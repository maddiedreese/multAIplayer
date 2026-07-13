# End-to-end coverage

Protocol v2 keeps MLS private state in the native Rust core. The browser build deliberately renders only `WebPreviewDemo`, so Playwright verifies that preview's no-relay/no-secret boundary and must not recreate the retired browser-side cryptography.

Security-critical journeys run at the narrowest layer that contains the real implementation:

| Journey                          | Executable coverage                                                                                                                                                                                                 | CI gate                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Invite approval and Welcome join | `apps/relay/test/process-security-journey.test.ts` drives the native MLS lifecycle fixture through real relay HTTP, WebSocket, KeyPackage consumption, Add Commit, and Welcome routing                              | `security-journey`                              |
| Signed active-host handoff       | The same process journey publishes a native handoff Commit, transfers authority to the successor device, and verifies the successor can publish the following removal/application epochs                            | `security-journey`                              |
| Codex turn approval              | `apps/desktop/test/alphaSmoke.test.ts` composes the approval snapshot and bounded Codex input from room messages, attachments, Git state, terminals, and approved browser context, then verifies locked-room denial | `web-and-relay` via the desktop workspace tests |
| Web preview isolation            | `e2e/web-shell.spec.ts` verifies the seeded preview cannot create, join, send, decrypt, persist private room material, or contact the relay                                                                         | `web-shell-e2e`                                 |

A future native UI driver may add full macOS interaction journeys, but it must exercise the real Rust MLS and Codex app-server boundaries. A JavaScript mock of Tauri commands is not an acceptable substitute for those security claims.
