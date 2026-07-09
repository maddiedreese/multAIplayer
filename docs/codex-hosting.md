# How Codex Hosting Works

multAIplayer does not use the OpenAI API and does not borrow another user's ChatGPT or Codex subscription from a hosted website.

Instead, a room has one active host. The host is a desktop user who has local access to:

- their own Codex app-server/session;
- the local project folder attached to the room;
- room-scoped terminal sessions;
- the room browser surface;
- local Git and optional GitHub OAuth through the relay.

People chat normally in the room. When someone clicks Codex or types `@Codex`, the app prepares a proposed Codex turn from the room context. The active host reviews and approves that turn. If approved, the host's local desktop app sends the prepared input to the host's local Codex app-server and streams the result back into the room as encrypted room events.

## What The Relay Can See

The relay routes metadata and ciphertext. It should not receive:

- plaintext room chat;
- plaintext attachments;
- Codex credentials;
- OpenAI credentials;
- repo files or diffs;
- terminal output;
- browser page contents;
- plaintext GitHub access tokens.

The relay does see operational metadata needed to route the room:

- team and room ids/names;
- room project path labels;
- host labels and status;
- device public keys and fingerprints;
- invite ids and expiry metadata;
- encrypted envelope sizes, ids, timestamps, and sender/device labels;
- encrypted attachment blob metadata such as filename, MIME type, declared size, room id, and expiry;
- GitHub OAuth session identity metadata when sign-in is enabled.

GitHub access tokens are used server-side only for identity, draft PR creation, and Actions reads. With `MULTAIPLAYER_RELAY_SESSION_SECRET` configured, stored tokens are encrypted at rest in the relay store. Without that secret, sessions are memory-only.

## Host Handoff

If a host runs out of Codex usage or needs to step away, they can create a handoff. The new host gets the room context and inherited room settings, then attaches their own local project folder. If they have access to the same GitHub repository, they can continue from the same branch or recreate the work locally.

The alpha sends the available room context to the new host's Codex invocation when accepting a usage-limit handoff. Codex-native compaction is not part of the public alpha contract.

## Browser And Terminal

The in-room browser and terminals are host-local capabilities. Room members can request actions, but the host approves sensitive steps and owns the local machine risk. Signed-in browser pages, terminal output, `.env` reads, credentials, and private repo content may become visible to the room if the host shares or approves them.
