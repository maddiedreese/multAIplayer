import type { MlsInviteCapabilityBinding, MlsInviteSealedPayload } from "../mls/mlsClient";

export interface DirectedMlsInviteCiphertext {
  version: 3;
  binding: MlsInviteCapabilityBinding;
  sealedPayload: MlsInviteSealedPayload;
}

export function parseDirectedMlsInviteCiphertext(value: string): DirectedMlsInviteCiphertext {
  const parsed = JSON.parse(value) as Partial<DirectedMlsInviteCiphertext>;
  if (
    parsed.version !== 3 ||
    parsed.binding?.version !== 3 ||
    parsed.binding.phase !== "request" ||
    !parsed.sealedPayload ||
    parsed.sealedPayload.version !== 1 ||
    !Array.isArray(parsed.sealedPayload.encapsulated_key) ||
    !Array.isArray(parsed.sealedPayload.ciphertext)
  )
    throw new Error("Invalid MLS invite request ciphertext");
  return parsed as DirectedMlsInviteCiphertext;
}

export function randomInviteNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
