import assert from "node:assert/strict";
import test from "node:test";
import { validateAssociationDocument, verifyLiveAssociations } from "./verify-aasa.mjs";

const appId = "ABCDEFGHIJ.com.multaiplayer.desktop";
const valid = {
  applinks: {
    details: [{ appIDs: [appId], components: [{ "/": "/invite" }, { "/": "/invite/" }] }]
  }
};

test("AASA validation requires the exact signed app and both invitation paths", () => {
  assert.equal(validateAssociationDocument(valid, appId), true);
  assert.equal(validateAssociationDocument(valid, `OTHERTEAM.${appId.split(".").slice(1).join(".")}`), false);
  assert.equal(
    validateAssociationDocument({ applinks: { details: [{ appIDs: [appId], components: [{ "/": "/*" }] }] } }, appId),
    false
  );
  assert.equal(
    validateAssociationDocument(
      {
        applinks: {
          details: [{ appIDs: [appId], components: [{ "/": "/invite" }, { "/": "/invite/*" }] }]
        }
      },
      appId
    ),
    false
  );
  assert.equal(
    validateAssociationDocument(
      {
        applinks: {
          details: [
            {
              appIDs: [appId],
              components: [{ "/": "/invite" }, { "/": "/invite/" }, { "/": "/*" }]
            }
          ]
        }
      },
      appId
    ),
    false
  );
  assert.equal(
    validateAssociationDocument(
      {
        applinks: {
          details: [
            ...valid.applinks.details,
            { appIDs: [appId], components: [{ "/": "/invite" }, { "/": "/invite/" }] }
          ]
        }
      },
      appId
    ),
    false
  );
});

test("live verification rejects redirects and non-JSON responses", async () => {
  await assert.rejects(
    verifyLiveAssociations({
      teamId: "ABCDEFGHIJ",
      fetchImpl: async () => new Response(null, { status: 301, headers: { location: "https://elsewhere.test" } })
    }),
    /HTTP 301/
  );
  await assert.rejects(
    verifyLiveAssociations({
      teamId: "ABCDEFGHIJ",
      fetchImpl: async () => new Response(JSON.stringify(valid), { headers: { "content-type": "text/plain" } })
    }),
    /application\/json/
  );
});

test("live verification checks both exact hosts", async () => {
  const requested = [];
  await verifyLiveAssociations({
    teamId: "ABCDEFGHIJ",
    fetchImpl: async (url) => {
      requested.push(String(url));
      return new Response(JSON.stringify(valid), { headers: { "content-type": "application/json" } });
    }
  });
  assert.deepEqual(requested, [
    "https://multaiplayer.com/.well-known/apple-app-site-association",
    "https://open.multaiplayer.com/.well-known/apple-app-site-association"
  ]);
});
