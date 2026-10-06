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
            <header className="flex items-center justify-between border-b border-border px-6 py-3">
              <Link href="/" className="text-lg font-semibold">
                {t("appName")}
              </Link>
              <div className="flex items-center gap-2">
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
            <main className="mx-auto max-w-3xl px-6 py-10">{children}</main>
          </DirectionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
