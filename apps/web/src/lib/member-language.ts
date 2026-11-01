import { defaultLocale, isLocale, type Locale, type SignedInMember } from "@rabaed/domain";

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/**
 * The language the signed-in Member opens in (RP-1174): the one they chose with the language
 * switch, else the one they were invited in. The page's own when the api can't say.
 * In the browser, after a sign-in.
 */
export async function memberLanguage(pageLocale: string, fetcher: Fetcher = fetch): Promise<Locale> {
  const fallback = isLocale(pageLocale) ? pageLocale : defaultLocale;
  try {
    const res = await fetcher("/api/v1/me", { cache: "no-store" });
    if (!res.ok) return fallback;
    const { member } = (await res.json()) as Pick<SignedInMember, "member">;
    return isLocale(member.language) ? member.language : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Keeps the language the Member switched to on the Member, so the next sign-in or visit opens in
 * it. A failure only means the next visit opens in the language they had; the switch still happens.
 */
export async function saveMemberLanguage(locale: Locale, fetcher: Fetcher = fetch): Promise<void> {
  try {
    await fetcher("/api/v1/me/language", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale }),
    });
  } catch {
    // The switch goes ahead.
  }
}
