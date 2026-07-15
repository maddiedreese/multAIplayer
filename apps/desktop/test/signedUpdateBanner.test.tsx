import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  releaseVerificationUrl,
  SignedUpdateBanner,
  UpdateVerificationWarning
} from "../src/components/SignedUpdateBanner";

test("update banner identifies pinned signature verification and requires an explicit install", () => {
  const releaseUrl = "https://github.com/maddiedreese/multAIplayer/releases/tag/v0.1.1";
  const markup = renderToStaticMarkup(
    <SignedUpdateBanner
      notice={{ currentVersion: "0.1.0", latestVersion: "0.1.1", url: releaseUrl }}
      installStatus="idle"
      onInstall={() => undefined}
    />
  );

  assert.match(markup, /Signed update available/);
  assert.match(markup, /user-initiated/);
  assert.match(markup, /pinned updater key verifies the download/);
  assert.match(markup, /Install signed update/);
  assert.ok(markup.includes(`href="${releaseUrl}"`));
  assert.ok(markup.includes(`href="${releaseVerificationUrl("0.1.1").replaceAll("&", "&amp;")}"`));
  assert.doesNotMatch(markup, /blob\/main/);
});

test("authentication failure is visible and points to manual verification", () => {
  const markup = renderToStaticMarkup(<UpdateVerificationWarning />);
  assert.match(markup, /Update check could not be verified/);
  assert.match(markup, /Nothing was downloaded or installed/);
  assert.match(markup, /manually verifiable release path/);
  assert.match(markup, /Manual verification/);
  assert.match(markup, /Updater key fingerprint/);
  assert.match(markup, /multaiplayer\.com\/security\/updater-key/);
});

test("update banner exposes installation progress and failure fallback", () => {
  const notice = {
    currentVersion: "0.1.0",
    latestVersion: "0.1.1",
    url: "https://github.com/maddiedreese/multAIplayer/releases/tag/v0.1.1"
  };
  assert.match(
    renderToStaticMarkup(<SignedUpdateBanner notice={notice} installStatus="installing" onInstall={() => undefined} />),
    /Installing…/
  );
  assert.match(
    renderToStaticMarkup(<SignedUpdateBanner notice={notice} installStatus="failed" onInstall={() => undefined} />),
    /use the verified release download/
  );
});
