export interface TerminalNameCandidate {
  name: string;
}

export function nextShellTerminalName(terminals: TerminalNameCandidate[], baseName = "shell"): string {
  const normalizedBase = baseName.trim() || "shell";
  const usedNames = new Set(terminals.map((terminal) => terminal.name.trim()).filter(Boolean));
  if (!usedNames.has(normalizedBase)) return normalizedBase;

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${normalizedBase}-${index}`;
    if (!usedNames.has(candidate)) return candidate;
  }

  return `${normalizedBase} ${Date.now()}`;
}

export function terminalInputForShellSubmit(input: string): string | null {
  if (!input.trim()) return null;
  return input.endsWith("\n") ? input : `${input}\n`;
}
