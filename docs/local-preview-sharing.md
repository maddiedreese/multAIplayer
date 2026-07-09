# Local Preview Sharing

Local preview sharing lets the active host expose a local development server, such as `http://localhost:3000`, to the room through a temporary public URL.

This is useful when a room is building a web app and other members, or Codex working with browser context, need to inspect the running app without setting up the project locally.

## Why cloudflared Is Required

The desktop app uses `cloudflared` to start a Cloudflare Quick Tunnel from the host's machine to the selected localhost URL. The app does not run its own public tunneling infrastructure, and the relay does not proxy preview traffic.

Using `cloudflared` keeps preview sharing host-controlled:

- the tunnel process runs on the active host's machine;
- the public URL points to the host's selected local server;
- the host can stop sharing from the room;
- the relay only routes the encrypted room event that announces the preview link.

## Install cloudflared

On macOS with Homebrew:

```bash
brew install cloudflare/cloudflare/cloudflared
```

After installation, restart the desktop app if it cannot find `cloudflared` on `PATH`.

The app checks for `cloudflared --version` before starting a preview. If `cloudflared` is missing, the local preview dialog shows the install command.

## How Preview Sharing Works

1. Start the local web app, for example `npm run dev`.
2. Open local preview sharing in the multAIplayer room.
3. Select or enter a localhost URL with an explicit port, such as `http://localhost:3000`.
4. Confirm the warning.
5. The desktop app starts `cloudflared tunnel --url <local-url>`.
6. When `cloudflared` returns a `trycloudflare.com` URL, the app shares that URL to the room as an encrypted preview event.

Only `localhost` and `127.0.0.1` URLs are accepted, and the URL must include a port.

## Security Notes

A local preview URL is public while the tunnel is running. Anyone with the `trycloudflare.com` link may be able to view the local web app until the host stops sharing or the tunnel exits.

Before sharing, assume the preview may expose:

- local development data;
- debug routes;
- test accounts or signed-in app state;
- API responses visible through the app;
- localhost-only admin screens;
- source maps or stack traces.

Do not use local preview sharing for private, regulated, or secret-bearing apps unless the host has reviewed the running app and accepts the exposure risk.

Stopping the preview ends the `cloudflared` tunnel process on the host machine and marks the room preview as unavailable.
