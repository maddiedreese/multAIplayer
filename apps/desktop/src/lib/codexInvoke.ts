const codexMentionPattern = /(^|[^\w@])@codex\b/i;

export function messageInvokesCodex(message: string): boolean {
  return codexMentionPattern.test(message);
}
