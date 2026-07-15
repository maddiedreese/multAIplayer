import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ManualUpdateBanner, releaseVerificationUrl } from "../src/components/ManualUpdateBanner";

test("update banner identifies manual delivery and links release plus verification instructions", () => {
  const releaseUrl = "https://github.com/maddiedreese/multAIplayer/releases/tag/v0.1.1";
  const markup = renderToStaticMarkup(
    <ManualUpdateBanner
      notice={{
        currentVersion: "0.1.0",
        latestVersion: "0.1.1",
        url: releaseUrl,
        security: true
      }}
    />
  );

  assert.match(markup, /Security update available/);
  assert.match(markup, /never installs updates automatically/);
  assert.ok(markup.includes(`href="${releaseUrl}"`));
  assert.ok(markup.includes(`href="${releaseVerificationUrl("0.1.1").replaceAll("&", "&amp;")}"`));
  assert.doesNotMatch(markup, /blob\/main/);
  assert.match(markup, /Verify with Sigstore/);
});
