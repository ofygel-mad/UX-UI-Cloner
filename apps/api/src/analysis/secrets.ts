import fs from "node:fs/promises";
import path from "node:path";
import type { CapturedResource, SecretFinding } from "../capture/types.js";

type SecretPattern = {
  type: string;
  pattern: RegExp;
  severity: SecretFinding["severity"];
};

const SECRET_PATTERNS: SecretPattern[] = [
  { type: "AWS Access Key", pattern: /AKIA[0-9A-Z]{16}/, severity: "critical" },
  { type: "AWS Secret Key", pattern: /aws[_\-.]?secret[_\-.]?(?:access[_\-.]?)?key['"\s]*[:=]['"\s]*([A-Za-z0-9/+=]{40})/, severity: "critical" },
  { type: "Google API Key", pattern: /AIza[0-9A-Za-z_\-]{35}/, severity: "critical" },
  { type: "Stripe Secret Key", pattern: /sk_live_[0-9a-zA-Z]{24}/, severity: "critical" },
  { type: "Stripe Publishable Key", pattern: /pk_live_[0-9a-zA-Z]{24}/, severity: "high" },
  { type: "JWT Token", pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, severity: "high" },
  { type: "Private RSA Key", pattern: /-----BEGIN (?:RSA )?PRIVATE KEY-----/, severity: "critical" },
  { type: "GitHub Token", pattern: /ghp_[A-Za-z0-9]{36}/, severity: "critical" },
  { type: "Slack Token", pattern: /xox[baprs]-[0-9A-Za-z]{10,}/, severity: "critical" },
  { type: "Generic API Key", pattern: /(?:api[_\-.]?key|apikey)\s*[:=]\s*['"]([A-Za-z0-9_\-]{16,64})['"]/, severity: "high" },
  { type: "Generic Secret", pattern: /(?:secret|password|passwd|pwd)\s*[:=]\s*['"]([^'"]{8,64})['"]/, severity: "medium" },
  { type: "Bearer Token", pattern: /[Aa]uthorization\s*:\s*['"]?Bearer\s+([A-Za-z0-9._\-]{20,})/, severity: "high" },
  { type: ".env Variable", pattern: /(?:^|\n)[A-Z_]{3,}_(?:KEY|SECRET|TOKEN|PASSWORD|PASS|PWD)\s*=\s*['"]?([^\s'"]{8,})/, severity: "medium" },
];

function maskValue(value: string): string {
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}${"*".repeat(Math.min(value.length - 8, 16))}${value.slice(-4)}`;
}

export async function scanForSecrets(
  resources: CapturedResource[],
  scanDir: string
): Promise<SecretFinding[]> {
  const findings: SecretFinding[] = [];
  const scannable = resources.filter((r) => ["js", "json", "html"].includes(r.kind));

  for (const res of scannable) {
    try {
      const content = await fs.readFile(path.join(scanDir, res.localPath), "utf-8");

      for (const { type, pattern, severity } of SECRET_PATTERNS) {
        const matches = content.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"));
        for (const match of matches) {
          const rawValue = match[1] ?? match[0];
          // Skip obvious false positives: template placeholders, very common words
          if (/\$\{|__placeholder__|your[_\-]?api|example|dummy/i.test(rawValue)) continue;

          findings.push({
            type,
            resourceId: res.id,
            resourceUrl: res.url,
            maskedValue: maskValue(rawValue),
            severity,
          });
          break; // one finding per pattern per file is enough
        }
      }
    } catch {}
  }

  // Deduplicate by type+resourceId
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.type}:${f.resourceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
