import { reportExpectedFailure } from "../../lib/core/nonFatalReporting";

interface AccountActionsOptions {
  stopOwnedLocalPreviews: (reason: string) => Promise<boolean>;
  signOutGitHub: () => Promise<void>;
  clearDeletedHostedAccount: () => void;
  reportUnconfirmedPreviewCleanup: () => void;
}

export function createAccountActions({
  stopOwnedLocalPreviews,
  signOutGitHub,
  clearDeletedHostedAccount,
  reportUnconfirmedPreviewCleanup
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
    try {
      await signOutGitHub();
    } finally {
      if (!previewCleanupConfirmed) reportUnconfirmedPreviewCleanup();
    }
  }

  async function hostedAccountDeleted() {
    const previewCleanupConfirmed = await cleanUpPreviews(
      "Stopped because the sharing user's hosted account was deleted."
    );
    clearDeletedHostedAccount();
    if (!previewCleanupConfirmed) reportUnconfirmedPreviewCleanup();
  }

  return { signOut, hostedAccountDeleted };
}
