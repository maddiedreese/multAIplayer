export type ClipboardCopyResult = { status: "copied" } | { status: "blocked"; reason: string };

export async function copyTextToClipboard(
  text: string,
  clipboard: Pick<Clipboard, "writeText"> | undefined = globalThis.navigator?.clipboard
): Promise<ClipboardCopyResult> {
  if (!clipboard?.writeText) {
    return { status: "blocked", reason: "Clipboard API is unavailable." };
  }
  try {
    await clipboard.writeText(text);
    return { status: "copied" };
  } catch (error) {
    return {
      status: "blocked",
      reason: error instanceof Error && error.message ? error.message : "Clipboard write was blocked."
    };
  }
}
