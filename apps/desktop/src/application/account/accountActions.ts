import { reportExpectedFailure } from "../../lib/core/nonFatalReporting";

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
  async function cleanUpPreviews(reason: string) {
    try {
      await stopOwnedLocalPreviews(reason);
    } catch {
      reportExpectedFailure("native preview cleanup failed during account exit");
    }
  }

  async function signOut() {
    await cleanUpPreviews("Stopped because the sharing user signed out.");
    await signOutGitHub();
  }

  async function hostedAccountDeleted() {
    await cleanUpPreviews("Stopped because the sharing user's hosted account was deleted.");
    clearDeletedHostedAccount();
  }

  return { signOut, hostedAccountDeleted };
}
