export function stripTerminalControlSequences(value: string): string {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\uFFFD\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[PX^_].*?\u001b\\/g, "")
    .replace(/\u001b[@-Z\\-_]/g, "")
    .replace(/\uFFFD/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}
