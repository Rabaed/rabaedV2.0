import { directionOf, isLocale } from "@rabaed/domain";
import { DirectionProvider } from "@rabaed/ui";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { LanguageSwitch } from "@/components/language-switch";
import { NotificationBell } from "@/components/notification-bell";
import { SignOutButton } from "@/components/sign-out-button";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getMe, getNotifications } from "@/lib/session";
import "../globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const metadata: Metadata = { title: "Rabaed" };

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("shell");
  const me = await getMe();
  const notifications = me ? await getNotifications() : null;

  return (
    <html lang={locale} dir={directionOf(locale)}>
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider>
          <DirectionProvider dir={directionOf(locale)}>
            <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-border px-4 py-3 sm:px-6">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <Link href="/" className="text-lg font-semibold">
                  {t("appName")}
                </Link>
                {/* The signed-in Member's places; the Projects page is also home. */}
                {me && (
                  <nav aria-label={t("nav")}>
                    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      <li>
                        <Link href="/projects" className="text-primary underline-offset-4 hover:underline">
                          {t("projects")}
                        </Link>
                      </li>
                      <li>
                        <Link href="/members" className="text-primary underline-offset-4 hover:underline">
                          {t("members")}
                        </Link>
                      </li>
                      {me.member.isAuthorizedPerson && (
                        <li>
                          <Link href="/participants" className="text-primary underline-offset-4 hover:underline">
                            {t("participations")}
                          </Link>
                        </li>
                      )}
                    </ul>
                  </nav>
                )}
              </div>
              <div className="flex items-center gap-2">
                {me && (
                  <span data-testid="signed-in-as" className="hidden text-sm text-muted md:inline">
                    {t("signedInAs", { name: me.member.fullName[locale], company: me.company.legalName[locale] })}
                  </span>
                )}
                {notifications && <NotificationBell unread={notifications.unread} />}
                {me && (
                  <Link href="/profile" className="px-2 text-sm font-medium text-primary underline-offset-4 hover:underline">
                    {t("profile")}
                  </Link>
                )}
                {me && <SignOutButton />}
                <LanguageSwitch />
              </div>
            </header>
            <main className="mx-auto max-w-[96rem] px-4 py-10 sm:px-6">{children}</main>
          </DirectionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
