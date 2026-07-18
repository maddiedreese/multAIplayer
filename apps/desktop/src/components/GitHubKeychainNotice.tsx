export function GitHubKeychainNotice({ compact = false }: { compact?: boolean }) {
  return (
    <p className={compact ? "github-keychain-notice compact" : "github-keychain-notice"}>
      macOS may show a Keychain access dialog after GitHub approves sign-in. multAIplayer stores only its GitHub sign-in
      credential there so it survives restarts; it cannot view unrelated Keychain items. Choose “Always Allow” to avoid
      being asked again for normally signed updates.
    </p>
  );
}
