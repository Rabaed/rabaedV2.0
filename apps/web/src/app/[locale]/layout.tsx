import { appearanceCookie, appearanceFromCookie, directionOf, isLocale } from "@rabaed/domain";
import { DirectionProvider } from "@rabaed/ui";
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AppFrame } from "@/components/app-frame";
import { RememberedModuleQueries } from "@/components/remembered-module-queries";
import { SignedOutFrame } from "@/components/signed-out-frame";
import { routing } from "@/i18n/routing";
import { getMe, getNotifications } from "@/lib/session";
import { sidebarCookie } from "@/lib/shell";
import { themeColorOf } from "@/lib/theme-color";
import "../globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const metadata: Metadata = { title: "Rabaed" };

/** The Member's Theme and Mode; signed out, the browser's mirror of the last Member's, else Warm, System. */
async function appearanceNow(me: Awaited<ReturnType<typeof getMe>>) {
  return me?.appearance ?? appearanceFromCookie((await cookies()).get(appearanceCookie)?.value);
}

/**
 * The page reaches under a phone's notch and home indicator (the bottom action bar pads itself by the
 * safe-area inset), and the browser's bar takes the top bar's colour (RP-1272).
 */
export async function generateViewport(): Promise<Viewport> {
  return { viewportFit: "cover", themeColor: themeColorOf(await appearanceNow(await getMe())) };
}

/**
 * Every page: signed in, inside the app shell (RP-406), whose top bar title
 * and Project tabs come from the `@heading` and `@tabs` slots; signed out
 * (accepting an invitation, the welcome), a plain centred page, except the
 * sign-in page, which draws its own (`SignedOutFrame`, RP-1057).
 */
export default async function LocaleLayout({
  children,
  heading,
  tabs,
  params,
}: {
  children: ReactNode;
  heading: ReactNode;
  tabs: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const me = await getMe();
  const notifications = me ? await getNotifications() : null;
  const jar = await cookies();
  const collapsed = jar.get(sidebarCookie)?.value === "collapsed";
  // The Member's Theme and Mode, painted by the server so the first paint is right (no flash).
  const appearance = await appearanceNow(me);

  return (
    <html lang={locale} dir={directionOf(locale)} data-theme={appearance.theme} data-mode={appearance.mode}>
      <body className="min-h-dvh bg-canvas text-text antialiased">
        <NextIntlClientProvider>
          <DirectionProvider dir={directionOf(locale)}>
            {me ? (
              // Each Module tab's last query, kept for this Member in their own browser (RP-1240).
              <RememberedModuleQueries memberId={me.member.id}>
                <AppFrame
                  locale={locale}
                  memberName={me.member.fullName[locale]}
                  companyName={me.company.legalName[locale]}
                  notifications={notifications}
                  defaultCollapsed={collapsed}
                  appearance={appearance}
                  heading={heading}
                  tabs={tabs}
                >
                  {children}
                </AppFrame>
              </RememberedModuleQueries>
            ) : (
              <SignedOutFrame>{children}</SignedOutFrame>
            )}
          </DirectionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
