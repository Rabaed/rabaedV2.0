/** What a setup command answered: done, or the API's refusal code (`unavailable` when it couldn't be reached). */
export type SetupResult = { ok: true; body: unknown } | { ok: false; error: string; status: number; body: unknown };

/**
 * Calls a Member API command from the browser, through the web's /api proxy (RP-441): the
 * Project Settings pages' writes (Workflows, Screens, Stages, outcomes). A refusal is
 * returned with the API's `error` code so the page can say why; the caller refreshes the page.
 */
export async function setupCall(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<SetupResult> {
  try {
    const res = await fetch(`/api/v1${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const parsed: unknown = await res.json().catch(() => null);
    if (res.ok) return { ok: true, body: parsed };
    const error = typeof parsed === "object" && parsed !== null && "error" in parsed && typeof parsed.error === "string" ? parsed.error : "unavailable";
    return { ok: false, error, status: res.status, body: parsed };
  } catch {
    return { ok: false, error: "unavailable", status: 0, body: null };
  }
}

/**
 * What a refused setup command says, in the page's words: the message `errors.<key>` that
 * `keys` names for the API's refusal code (`not_found` and `project_closed` are every page's
 * `errors.notFound` and `errors.projectClosed`), else `errors.unavailable`.
 */
export function refusalMessage(t: (key: string) => string, keys: Readonly<Record<string, string>>, error: string): string {
  const named: Record<string, string> = { not_found: "notFound", project_closed: "projectClosed", ...keys };
  return t(`errors.${named[error] ?? "unavailable"}`);
}

/** A name in both languages from a form's `nameEn` and `nameAr` fields, trimmed; null when either is empty. */
export function bilingualNameOf(form: FormData): { en: string; ar: string } | null {
  const en = String(form.get("nameEn") ?? "").trim();
  const ar = String(form.get("nameAr") ?? "").trim();
  return en && ar ? { en, ar } : null;
}

/** The new id a create command answered with (`{ id }`), if it did. */
export function createdId(result: SetupResult): string | null {
  if (!result.ok || typeof result.body !== "object" || result.body === null || !("id" in result.body)) return null;
  return typeof result.body.id === "string" ? result.body.id : null;
}
