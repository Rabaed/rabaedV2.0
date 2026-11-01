import type { PublishDefaultsResult } from "./rabaed-defaults.ts";

// The deploy's publish of the Rabaed Defaults (RP-1205): `publishRabaedDefaults` as deploy-uat.yml
// runs it after the migrations, through `defaults:publish --ci`. The repository is public, so its
// run logs and step summaries show whatever this prints: counts, and the keys of the Forms,
// Workflows and Screens it published. Never a Member, an email, a URL, nor the text of an error
// or of a warning; whatever it does print still passes `mask`.

/** The database behind the publish: who the deploy acts as, and the publish itself. */
export interface DeployPublisher {
  /** The id of the active Rabaed Engineer with this email, or null. */
  findEngineer(email: string): Promise<string | null>;
  publish(engineerId: string, reason: string): Promise<PublishDefaultsResult>;
}

export interface DeployOutput {
  log(line: string): void;
  error(line: string): void;
}

/**
 * `text` with every URL and email address replaced: the public log must show neither. An
 * address needs a dot after its `@`, so the key of an earlier Workflow Version (`WIR@2`) stays.
 */
export function mask(text: string): string {
  return text.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>").replace(/[^\s"',:<>@]+@[^\s"',:<>@]+\.[^\s"',:<>@]+/g, "<email>");
}

const CODE = /^[A-Za-z0-9_.-]{1,64}$/;
/** A machine code (`projects_lack_entries`) as it is, anything else not at all. */
const codeOf = (value: unknown): string | undefined => (typeof value === "string" && CODE.test(value) ? value : undefined);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What a refusal says besides its reason: each number as it is, each list as its length and, for
 * a list of problems, their codes (never their texts, which can name anything).
 */
function refusalDetail(result: object): string[] {
  const detail: string[] = [];
  for (const [key, value] of Object.entries(result)) {
    if (key === "ok" || key === "reason" || !CODE.test(key)) continue;
    if (typeof value === "number") detail.push(`${key}: ${value}`);
    else if (Array.isArray(value)) {
      const codes = [...new Set(value.map((item) => codeOf((item as { code?: unknown } | null)?.code)).filter((code) => code !== undefined))];
      detail.push(`${key}: ${value.length}${codes.length > 0 ? ` (${codes.join(", ")})` : ""}`);
    }
  }
  return detail;
}

/**
 * Publishes every Rabaed Default that differs from its latest published Version, as the active
 * Rabaed Engineer `engineerEmail` with `reason`, and reports counts and keys. Returns the exit
 * code: 0 when it published or found nothing to publish; 1 for an Engineer who is not active, a
 * refusal (which stops it; what it published before stays, each publish being its own
 * transaction) or any error, each said in one plain line. It never half-publishes silently.
 */
export async function publishDefaultsForDeploy(
  publisher: DeployPublisher,
  { engineerEmail, reason }: { engineerEmail: string; reason: string },
  output: DeployOutput,
): Promise<number> {
  const log = (line: string) => output.log(mask(line));
  const error = (line: string) => output.error(mask(line));
  try {
    const engineerId = await publisher.findEngineer(engineerEmail.trim().toLowerCase());
    if (!engineerId) {
      error("No active Rabaed Engineer for the deploy's Engineer email; nothing published.");
      return 1;
    }
    const result = await publisher.publish(engineerId, reason);
    if (!result.ok) {
      const reasonCode = codeOf((result.result as { reason?: unknown }).reason) ?? "unknown_reason";
      const detail = refusalDetail(result.result);
      error(`Rabaed Defaults refused at the ${result.kind} ${result.name}: ${reasonCode}${detail.length > 0 ? ` (${detail.join(", ")})` : ""}; nothing more was published, and what was published before stays.`);
      return 1;
    }
    const published = result.done.filter((d) => d.published);
    const warnings = result.done.reduce((sum, d) => sum + (d.warnings?.length ?? 0), 0);
    const moved = result.moved.reduce((sum, m) => sum + m.moved, 0);
    log(`Rabaed Defaults: published ${published.length}, unchanged ${result.done.length - published.length}${published.length === 0 && moved === 0 ? "; nothing to publish." : "."}`);
    for (const d of published) log(`  ${d.kind} ${d.name}: Version ${d.versionNo}`);
    if (warnings > 0) log(`  ${plural(warnings, "warning", "warnings")} on the published Versions`);
    if (moved > 0) log(`  open items moved off a retired Version: ${moved}`);
    return 0;
  } catch (cause) {
    // Not the message: a database error quotes its connection.
    const name = codeOf((cause as { code?: unknown } | null)?.code) ?? codeOf((cause as { name?: unknown } | null)?.name) ?? "Error";
    error(`Rabaed Defaults publish failed (${name}); the error itself is not printed, as its message can quote the connection.`);
    return 1;
  }
}
