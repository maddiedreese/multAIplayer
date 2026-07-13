import React from "react";

const demoMessages = [
  {
    author: "Maddie",
    time: "9:41 AM",
    body: "This seeded room shows the multAIplayer conversation layout without joining a relay room."
  },
  {
    author: "Codex",
    time: "9:42 AM",
    body: "Open the native desktop app to create or join an end-to-end encrypted MLS room."
  }
] as const;

/**
 * A deliberately local-only product preview.
 *
 * Keep this component independent of the application store, identity hooks, relay
 * clients, and room crypto. Browser builds must never initialize those boundaries.
 */
export function WebPreviewDemo() {
  return (
    <main className="web-demo" data-testid="web-preview-demo">
      <header className="web-preview-banner" role="status">
        <strong>Local demo preview</strong>
        <span>Seeded content only. End-to-end encrypted rooms require the native desktop app.</span>
      </header>

      <div className="web-demo-layout">
        <aside className="web-demo-sidebar" aria-label="Demo rooms">
          <div className="web-demo-brand">
            <strong>multAIplayer</strong>
            <span>Browser demo</span>
          </div>
          <p className="web-demo-section-label">Demo workspace</p>
          <button className="web-demo-room selected" type="button" aria-current="page">
            Welcome room
          </button>
          <button type="button" disabled title="Available in the native desktop app">
            New encrypted room
          </button>
          <button type="button" disabled title="Available in the native desktop app">
            Join with invite
          </button>
        </aside>

        <section className="web-demo-room-view" aria-labelledby="web-demo-room-title">
          <div className="web-demo-room-header">
            <div>
              <p className="web-demo-eyebrow">Seeded local room</p>
              <h1 id="web-demo-room-title">Welcome room</h1>
            </div>
            <span className="web-demo-local-badge">No relay connection</span>
          </div>

          <div className="web-demo-notice">
            This browser preview cannot create, join, send to, or decrypt MLS rooms. It contains no device identity,
            private key, group state, or persisted room history.
          </div>

          <div className="web-demo-messages" aria-label="Seeded demo conversation">
            {demoMessages.map((message) => (
              <article className="web-demo-message" key={`${message.author}-${message.time}`}>
                <div>
                  <strong>{message.author}</strong>
                  <time>{message.time}</time>
                </div>
                <p>{message.body}</p>
              </article>
            ))}
          </div>

          <form className="web-demo-composer" onSubmit={(event) => event.preventDefault()}>
            <textarea
              aria-label="Demo message composer"
              disabled
              value="Messaging is available in the native app."
              readOnly
            />
            <button type="submit" disabled>
              Send message
            </button>
          </form>
        </section>

        <aside className="web-demo-inspector" aria-label="Demo limitations">
          <h2>Native-only features</h2>
          <ul>
            <li>MLS room creation and invites</li>
            <li>Encrypted messaging and history</li>
            <li>Member removal and host handoff</li>
            <li>Codex, terminal, browser, and Git actions</li>
          </ul>
          <p>Install and open the desktop app to use a real room.</p>
        </aside>
      </div>
    </main>
  );
}
