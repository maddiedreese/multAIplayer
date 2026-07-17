interface AccountActionsOptions {
  stopOwnedLocalPreviews: (reason: string) => Promise<void>;
  signOutGitHub: () => Promise<void>;
}

export function createAccountActions({ stopOwnedLocalPreviews, signOutGitHub }: AccountActionsOptions) {
  async function signOut() {
    await stopOwnedLocalPreviews("Stopped because the sharing user signed out.");
    await signOutGitHub();
  }

  return { signOut };
}
