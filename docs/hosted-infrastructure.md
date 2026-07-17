# Hosted infrastructure and source boundaries

The open-source repository contains the desktop application, relay service, release workflow, updater channel, protocol packages, tests, and their normative security documentation. The hosted service combines those public components with operator-managed deployment configuration.

## Public application repository

`maddiedreese/multAIplayer` owns the application and relay source, GitHub release workflow, signed updater metadata, updater public key, and the canonical [release asset contract](release-assets.v1.json). GitHub Releases are created as drafts and become public only after the repository’s automated release gates and the protected release-environment deployment complete. GitHub records the deployment, its status, timestamps, and reviewer identity when required reviewers are configured. The maintainer completes the [exact-artifact acceptance checklist](reproducible-builds.md#approve-the-exact-release-artifact) before approving that deployment; the environment record does not itself prove those checks ran.

## Project website

`multaiplayer.com` and `open.multaiplayer.com` are deployed from the separate public [`maddiedreese/multaiplayer-site`](https://github.com/maddiedreese/multaiplayer-site) repository on Netlify. It owns public informational/legal pages, the invite landing page and fragment scrubbing, Apple App Site Association responses, the independently hosted updater-key fingerprint, and the website projection of the latest supported GitHub Release.

The website is therefore a separate deployment and review boundary, not code bundled into the desktop app or relay. Contributors can reproduce its static export and inspect its Netlify configuration from that repository; DNS, Netlify account state, custom-domain configuration, and production environment values remain operator-managed. A website change affecting invitation handling, AASA, updater-key presentation, privacy/legal text, or supported-release selection requires review and tests in the website repository plus any corresponding update to the public threat model or asset contract here.

## Hosted relay

The official relay deploys the public `apps/relay` container to Railway with operator-managed persistence, deletion-ledger, origin/rate-limit, and monitoring configuration. The official native desktop is compiled separately with the public GitHub Device Flow client id and exact relay origin. Secrets and production data are not repository content. [Self-hosting](self-hosting.md) documents the public deployment contract and operational requirements; it does not imply access to the hosted operator account.

Separating deployments is not an independent security guarantee. A maintainer or hosting-account compromise may affect the surface controlled by that account. The [threat model](threat-model.md) remains authoritative for those residual risks.
