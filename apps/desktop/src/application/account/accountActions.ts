interface AccountActionsOptions {
  stopOwnedLocalPreviews: (reason: string) => Promise<void>;
  signOutGitHub: () => Promise<void>;
  clearDeletedHostedAccount: () => void;
}

export function createAccountActions({
  stopOwnedLocalPreviews,
  signOutGitHub,
  clearDeletedHostedAccount
}: AccountActionsOptions) {
  async function signOut() {
    await stopOwnedLocalPreviews("Stopped because the sharing user signed out.");
    await signOutGitHub();
  }

  async function hostedAccountDeleted() {
    await stopOwnedLocalPreviews("Stopped because the sharing user's hosted account was deleted.");
    clearDeletedHostedAccount();
  }

  return { signOut, hostedAccountDeleted };
}
