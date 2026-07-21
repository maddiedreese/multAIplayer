export function projectStatusLabel(branch: string | null | undefined): string {
  return branch?.trim() || "Local folder";
}
