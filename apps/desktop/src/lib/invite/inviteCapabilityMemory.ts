const issuedCapabilities = new Map<string, { capabilityHandle: string; capabilityUrlValue: string }>();

/** Issued URL capabilities remain process-memory only; restarting invalidates unapproved links. */
export function rememberIssuedMlsInvite(
  inviteId: string,
  capability: { capabilityHandle: string; capabilityUrlValue: string }
): void {
  issuedCapabilities.set(inviteId, { ...capability });
}

export function loadIssuedMlsInvite(inviteId: string) {
  const capability = issuedCapabilities.get(inviteId);
  return capability ? { ...capability } : null;
}

export function consumeIssuedMlsInvite(inviteId: string): void {
  issuedCapabilities.delete(inviteId);
}
