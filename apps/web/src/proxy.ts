import { isLocale, type SignedInMember } from "@rabaed/domain";
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing.ts";
import { apiUrl } from "./lib/api-url.ts";
import { readApiJson, readTimeouts } from "./lib/api-read.ts";

const intl = createMiddleware(routing);

/** The api's session cookie (apps/api `SESSION_COOKIE`): a visit without it has no Member to ask about. */
const sessionCookie = /(?:^|;\s*)rabaed_session=/;

/**
 * Rabaed opens in Arabic, whatever the browser asks for (owner decision 2026-11-01, RP-1174): the
 * address without a language goes to `/ar`. A signed-in Member who switched to English goes to
 * `/en` instead, the language kept on the Member. An address that names a language is that
 * language: the Member's choice is made with the language switch, not by a link.
 */
export default async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const namesLanguage = isLocale(pathname.split("/")[1] ?? "");
  const cookie = request.headers.get("cookie") ?? "";
  if (!namesLanguage && sessionCookie.test(cookie)) {
    const me = await readApiJson<SignedInMember>(`${apiUrl}/v1/me`, { cookie, timeoutMs: readTimeouts.small });
    if (me.kind === "ok" && me.value.member.language !== routing.defaultLocale) {
      const path = pathname === "/" ? "" : pathname;
      return NextResponse.redirect(new URL(`/${me.value.member.language}${path}${search}`, request.url));
    }
  }
  return intl(request);
}

export const config = {
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
