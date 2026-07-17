import { reportExpectedFailure } from "../core/nonFatalReporting";

const secretTextLimit = 120_000;

export function detectSecretRisks(text: string, path = ""): string[] {
  const risks = new Set<string>();
  const normalizedPath = path.toLowerCase();
  const value = text.slice(0, secretTextLimit);

  if (
    /(^|\/)\.env($|[./-])/.test(normalizedPath) ||
    /(^|\/)(id_rsa|id_ed25519|\.npmrc|\.pypirc|credentials|secrets)\b/.test(normalizedPath) ||
    /(^|\/)\.(aws|config)\/credentials$/.test(normalizedPath)
  ) {
    risks.add("Sensitive file access");
  }
  if (/(^|\n)\s*(env|printenv|export)\b/.test(value) || /\b[A-Z][A-Z0-9_]{2,}\s*=\s*["']?[^"'\s]{8,}/.test(value)) {
    risks.add("Environment variables");
  }
  if (
    /(api[_-]?(key|token)|access[_-]?key(?:[_-]?id)?|access[_-]?token|auth[_-]?token|\btoken|secret|password|passwd|private[_-]?key)\s*[:=]/i.test(
      value
    )
  ) {
    risks.add("Credential-looking output");
  }
  if (
    /(ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----)/.test(
      value
    )
  ) {
    risks.add("Token or private key pattern");
  }

  return Array.from(risks);
}

export function detectTerminalCommandRisks(command: string): string[] {
  const risks = new Set<string>();
  const value = command.trim();
  const lower = value.toLowerCase();

  if (!value) return [];

  if (/(^|[;&|]\s*)(env|printenv|export)(\s|$)/.test(lower)) {
    risks.add("Environment variables");
  }
  if (
    /(^|\s)(cat|less|more|tail|head|sed|awk|grep|rg|bat|open|code|vim|nano)\s+[^;&|]*\.env($|[./\s"'-])/.test(lower) ||
    /(^|\s)(cat|less|more|tail|head|sed|awk|grep|rg|bat|open|code|vim|nano)\s+[^;&|]*(id_rsa|id_ed25519|\.npmrc|\.pypirc|credentials|secrets)\b/.test(
      lower
    ) ||
    /(^|\s)(cat|less|more|tail|head|sed|awk|grep|rg|bat|open|code|vim|nano)\s+[^;&|]*\.(aws|config)\/credentials\b/.test(
      lower
    )
  ) {
    risks.add("Sensitive file access");
  }
  if (
    /(api[_-]?(key|token)|access[_-]?key(?:[_-]?id)?|access[_-]?token|auth[_-]?token|\btoken|secret|password|passwd|private[_-]?key)\s*[:=]/i.test(
      value
    )
  ) {
    risks.add("Credential-looking command");
  }
  if (
    /(ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----)/.test(
      value
    )
  ) {
    risks.add("Token or private key pattern");
  }

  return Array.from(risks);
}
