import { reportExpectedFailure } from "../../lib/core/nonFatalReporting";

interface AccountActionsOptions {
  stopOwnedLocalPreviews: (reason: string) => Promise<boolean>;
  resumeLocalPreviewSharing: () => void;
  signOutGitHub: () => Promise<void>;
  clearDeletedHostedAccount: () => void;
  reportUnconfirmedPreviewCleanup: () => void;
}

export function createAccountActions({
  stopOwnedLocalPreviews,
  resumeLocalPreviewSharing,
  signOutGitHub,
  clearDeletedHostedAccount,
  reportUnconfirmedPreviewCleanup
}: AccountActionsOptions) {
  let hostedAccountPreviewCleanupConfirmed: boolean | null = null;

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

  async function prepareHostedAccountDeletion() {
    hostedAccountPreviewCleanupConfirmed = await cleanUpPreviews(
      "Stopped because the sharing user requested hosted account deletion."
    );
    if (!hostedAccountPreviewCleanupConfirmed) reportUnconfirmedPreviewCleanup();
  }

  async function hostedAccountDeleted() {
    const previewCleanupConfirmed =
      hostedAccountPreviewCleanupConfirmed ??
      (await cleanUpPreviews("Stopped because the sharing user's hosted account was deleted."));
    hostedAccountPreviewCleanupConfirmed = null;
    clearDeletedHostedAccount();
    if (!previewCleanupConfirmed) reportUnconfirmedPreviewCleanup();
  }

  function hostedAccountDeletionRejected() {
    hostedAccountPreviewCleanupConfirmed = null;
    resumeLocalPreviewSharing();
  }

  return { signOut, prepareHostedAccountDeletion, hostedAccountDeleted, hostedAccountDeletionRejected };
}
