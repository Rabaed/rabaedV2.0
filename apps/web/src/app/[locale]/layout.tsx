import { directionOf, isLocale } from "@rabaed/domain";
import { DirectionProvider } from "@rabaed/ui";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AppFrame } from "@/components/app-frame";
import { LanguageSwitch } from "@/components/language-switch";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getMe, getNotifications } from "@/lib/session";
import { sidebarCookie } from "@/lib/shell";
import "../globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const metadata: Metadata = { title: "Rabaed" };

/**
 * Every page: signed in, inside the app shell (RP-406), whose top bar title
 * and Project tabs come from the `@heading` and `@tabs` slots; signed out
 * (sign-in, accepting an invitation, the welcome), a plain centred page.
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
  const t = await getTranslations("shell");
  const me = await getMe();
  const notifications = me ? await getNotifications() : null;
  const collapsed = (await cookies()).get(sidebarCookie)?.value === "collapsed";

  return (
    <html lang={locale} dir={directionOf(locale)}>
      <body className="min-h-dvh bg-canvas text-text antialiased">
        <NextIntlClientProvider>
          <DirectionProvider dir={directionOf(locale)}>
            {me ? (
              <AppFrame
                locale={locale}
                memberName={me.member.fullName[locale]}
                companyName={me.company.legalName[locale]}
                isAuthorizedPerson={me.member.isAuthorizedPerson}
                unread={notifications?.unread ?? null}
                defaultCollapsed={collapsed}
                heading={heading}
                tabs={tabs}
              >
                {children}
              </AppFrame>
            ) : (
              <>
                <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-4 py-3 sm:px-6">
                  <Link href="/" className="font-display text-lg font-semibold">
                    {t("appName")}
                  </Link>
                  <LanguageSwitch />
                </header>
                <main className="mx-auto w-full max-w-xl px-4 py-10 sm:px-6">{children}</main>
              </>
            )}
          </DirectionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
