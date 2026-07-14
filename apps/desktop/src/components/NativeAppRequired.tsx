import { PRIVACY_POLICY_URL, PRODUCT_SITE_URL, TERMS_OF_SERVICE_URL } from "../lib/productLinks";

/**
 * The production product is native-only. Vite still serves a browser document for
 * development and component tests, but it must never resemble a usable workspace
 * or initialize identity, relay, project, or MLS state.
 */
export function NativeAppRequired() {
  return (
    <main className="native-required" data-testid="native-app-required">
      <section>
        <p className="native-required-eyebrow">Native desktop app required</p>
        <h1>multAIplayer runs on Apple silicon Macs.</h1>
        <p>
          There is no browser preview or browser workspace. Once the supported signed release is published, install its
          native app on macOS 11 or later to create or join a room.
        </p>
        <nav aria-label="Product and legal links">
          <a href={PRODUCT_SITE_URL} target="_blank" rel="noreferrer noopener">
            Visit multaiplayer.com
          </a>
          <a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer noopener">
            Privacy Policy
          </a>
          <a href={TERMS_OF_SERVICE_URL} target="_blank" rel="noreferrer noopener">
            Terms of Service
          </a>
        </nav>
      </section>
    </main>
  );
}
