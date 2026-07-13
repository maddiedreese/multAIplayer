import { z } from "zod";
import { maxSessionCiphertextNonceChars } from "./limits-ids.js";

/**
 * Relay-local, at-rest encryption container for a GitHub auth-session token.
 * This is not a room-message envelope and never crosses the relay API boundary.
 */
export const SessionAccessTokenCiphertext = z.object({
  algorithm: z.literal("AES-GCM-256"),
  nonce: z.string().min(1).max(maxSessionCiphertextNonceChars),
  ciphertext: z.string().min(1),
  tag: z.string().min(1).max(maxSessionCiphertextNonceChars)
});

export type SessionAccessTokenCiphertext = z.infer<typeof SessionAccessTokenCiphertext>;
