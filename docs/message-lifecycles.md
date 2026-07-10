# Message lifecycles

These traces show the vertical call order for the two room flows that cross the most package boundaries.
They describe the connected-relay path; local-only chat stops after the optimistic store append.

## Life of a chat message

1. `apps/desktop/src/components/RoomChatPanel.tsx` — `RoomChatPanel` calls `onSendMessage` from the composer button or Enter key.
2. `apps/desktop/src/components/RoomMainColumnContainer.tsx` — `RoomMainColumnContainer` wires that prop to `roomRuntime.sendMessage`.
3. `apps/desktop/src/hooks/useCodexRoomActions.ts` — `useCodexRoomActions` exposes the `sendMessage` action assembled for the room.
4. `apps/desktop/src/lib/codexInvokeActions.ts` — `createCodexInvokeActions().sendMessage` validates room access, draft, and attachments.
5. The same function creates the `ChatMessage`; `@Codex` changes its role and later opens the Codex proposal path.
6. `apps/desktop/src/lib/chatActions.ts` — `createChatActions().publishChatMessage` selects the room and checks relay state.
7. `apps/desktop/src/lib/localHistory.ts` — `loadOrCreateRoomSecret` supplies the device-local symmetric room key.
8. `packages/crypto/src/index.ts` — `encryptJson` serializes the message and encrypts it with AES-GCM.
9. `packages/protocol/src/plaintext-events.ts` — `ChatPlaintextPayload` defines the plaintext shape encrypted in the payload.
10. `packages/protocol/src/relay-messages.ts` — `RelayEnvelope` and `RelayClientMessage` define the `chat.message` publish wire shape.
11. `apps/desktop/src/lib/chatActions.ts` — the publisher records the envelope ID, calls `RelayClient.publish`, then appends optimistically.
12. `apps/desktop/src/store/slices/workspaceDataSlice.ts` — `appendRoomMessage` deduplicates by message ID and updates `messagesByRoom`.
13. `apps/desktop/src/lib/relayClient.ts` — `connectRelay`'s client serializes the publish message onto the WebSocket.
14. `apps/relay/src/ws/connection.ts` — `registerRelayWebSocketConnection` parses it with `RelayClientMessage` and enforces limits.
15. `apps/relay/src/server.ts` — `canPublishEnvelope` binds room, user, and device to the joined socket.
16. `apps/relay/src/ws/connection.ts` — the publish branch calls `publishEnvelope` only after authorization and payload checks.
17. `apps/relay/src/ws/fanout.ts` — `publishEnvelope` deduplicates, prunes and persists encrypted backlog, then calls `broadcast`.
18. The relay broadcasts `{ type: "envelope" }` to every socket joined to the room; it never decrypts the payload.
19. `apps/desktop/src/lib/relayClient.ts` — each recipient parses the WebSocket frame and invokes its `onMessage` callback.
20. `apps/desktop/src/hooks/relay/useRelaySubscription.ts` — `useRelaySubscription` rejects seen IDs and calls `routeRelayEnvelope`.
21. This makes the origin ignore its relay echo because it recorded the envelope ID before publishing.
22. `apps/desktop/src/hooks/relay/routeRelayEnvelope.ts` — `routeRelayEnvelope` loads the room secret for `chat.message`.
23. `packages/crypto/src/index.ts` — `decryptJson` authenticates and decrypts the AES-GCM payload on the recipient device.
24. `packages/protocol/src/plaintext-events.ts` — `ChatPlaintextPayload.safeParse` rejects malformed decrypted data.
25. `apps/desktop/src/lib/chatSanitizer.ts` — `normalizeChatMessage` applies the final client-side message normalization.
26. `apps/desktop/src/hooks/relay/routeRelayEnvelope.ts` — the route marks unread state and calls `appendRoomMessage`.
27. `apps/desktop/src/store/slices/workspaceDataSlice.ts` — the peer store deduplicates and appends the message.
28. `apps/desktop/src/lib/roomNotifications.ts` — `sendRoomMessageNotification` may notify a muted/background recipient.
29. `apps/desktop/src/lib/chatDisplayRows.ts` — `buildRoomChatMessageRows` derives the renderable rows from store messages.
30. `apps/desktop/src/components/RoomChatPanel.tsx` — `RoomChatPanel` renders the new row in the transcript.

## Life of a Codex turn

1. `apps/desktop/src/components/RoomChatPanel.tsx` — a user invokes Codex with the button or sends an `@Codex` message.
2. `apps/desktop/src/lib/codexInvokeActions.ts` — `sendMessage` uses `messageInvokesCodex`, then calls `handleCodexInvoke`.
3. `apps/desktop/src/lib/codexTurn.ts` — `buildCodexApprovalSnapshot` selects the chat delta, attachments, and bounded room context.
4. `apps/desktop/src/lib/codexInvokeActions.ts` — `handleCodexInvoke` creates a `QueuedCodexTurn` and pending host approval.
5. `apps/desktop/src/store/slices/codexHostHandoffSlice.ts` — queue and approval actions store that proposal per room.
6. `apps/desktop/src/hooks/useRelayPublishers.ts` — `publishCodexQueueEvent` encrypts and shares the room-visible queue state.
7. `apps/desktop/src/components/CodexApprovalCard.tsx` — the active host reviews the snapshot and calls `onApprove`.
8. `apps/desktop/src/lib/roomChatPanelActions.ts` — `onApproveApproval` delegates to `approveCodexTurn`.
9. `apps/desktop/src/hooks/useCodexTurnActions.ts` — `approveCodexTurn` rechecks host, room, compatibility, and current context.
10. `apps/desktop/src/lib/codexTurn.ts` — `buildCodexTurnSummary`, `buildCodexTurnInput`, and `detectCodexTurnRiskFlags` build the run input.
11. `apps/desktop/src/hooks/useRelayPublishers.ts` — `publishCodexEvent` shares the encrypted `started` event through the chat relay path.
12. `apps/desktop/src/lib/localBackend/codexBackend.ts` — `runCodexTurn` invokes the native `run_codex_turn` Tauri command.
13. `apps/desktop/src-tauri/src/lib.rs` — the Tauri invoke handler registers `run_codex_turn`.
14. `apps/desktop/src-tauri/src/codex.rs` — `run_codex_turn` validates room, directory, input, model, timeout, and sandbox.
15. `apps/desktop/src-tauri/src/codex_turn_lifecycle.rs` — `CodexTurnLease::begin` prevents concurrent turns in the room and supports cancellation.
16. `apps/desktop/src-tauri/src/codex.rs` — `checkout_codex_session` reuses a compatible session or starts `CodexServerSession`.
17. `CodexServerSession::start` launches local `codex app-server`, sends `initialize`, then sends `initialized`.
18. `apps/desktop/src-tauri/src/codex_rpc.rs` — `send_json_shared` writes JSON-RPC and `RpcInbox` classifies stdout lines.
19. `apps/desktop/src-tauri/src/codex.rs` — `CodexServerSession::run_turn` sends `thread/resume` or `thread/start`.
20. After obtaining a thread ID, it sends `turn/start` with text input, cwd, model, reasoning, and service tier.
21. `apps/desktop/src-tauri/src/codex_requests.rs` — `CodexRpcState::register` projects supported server requests for host approval.
22. `apps/desktop/src-tauri/src/codex.rs` — the receive loop collects message deltas and waits for `turn/completed`.
23. The native command returns `CodexTurnResult` with thread ID, status, transcript, events, and host-local stderr.
24. `apps/desktop/src/hooks/useCodexTurnActions.ts` — `approveCodexTurn` saves the normalized thread ID and projects safe events.
25. `apps/desktop/src/lib/codexRoomSharing.ts` — `projectCodexRoomEvent` and `projectCodexRoomStatus` strip host-local diagnostics.
26. `apps/desktop/src/hooks/useRelayPublishers.ts` — `publishCodexEvent` encrypts safe progress and completion events.
27. `packages/protocol/src/plaintext-events.ts` — `CodexEventPlaintextPayload` validates the encrypted lifecycle payload.
28. `apps/desktop/src/hooks/useCodexTurnActions.ts` — the final transcript becomes a `ChatMessage` with role `codex`.
29. `apps/desktop/src/lib/chatActions.ts` — `publishChatMessage` encrypts, publishes, and optimistically appends that response.
30. `apps/relay/src/ws/connection.ts` and `apps/relay/src/ws/fanout.ts` authorize, persist ciphertext, and fan it out.
31. `apps/desktop/src/hooks/relay/routeRelayEnvelope.ts` — peers decrypt `codex.event` into activity and `chat.message` into transcript.
32. `apps/desktop/src/store/slices/codexHostHandoffSlice.ts` appends events; `apps/desktop/src/store/slices/workspaceDataSlice.ts` appends chat.
33. `apps/desktop/src/components/RoomChatPanel.tsx` — peers see the completed Codex response in the room transcript.
34. `apps/desktop/src/hooks/useCodexTurnActions.ts` — `finally` clears running state and promotes the next queued approval.
