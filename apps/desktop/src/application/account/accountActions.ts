import { reportExpectedFailure } from "../../lib/core/nonFatalReporting";

interface AccountActionsOptions {
  stopOwnedLocalPreviews: (reason: string) => Promise<boolean>;
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
      return await stopOwnedLocalPreviews(reason);
    } catch {
      reportExpectedFailure("native preview cleanup failed during account exit");
      return false;
    }
  }

  async function signOut() {
    const previewCleanupConfirmed = await cleanUpPreviews("Stopped because the sharing user signed out.");
    await signOutGitHub();
    return previewCleanupConfirmed;
  }

  async function hostedAccountDeleted() {
    const previewCleanupConfirmed = await cleanUpPreviews(
      "Stopped because the sharing user's hosted account was deleted."
    );
    clearDeletedHostedAccount();
    return previewCleanupConfirmed;
  }

  return { signOut, hostedAccountDeleted };
}
