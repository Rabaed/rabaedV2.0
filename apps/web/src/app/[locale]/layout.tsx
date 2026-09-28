import { directionOf, isLocale } from "@rabaed/domain";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { LanguageSwitch } from "@/components/language-switch";
import { SignOutButton } from "@/components/sign-out-button";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getMe } from "@/lib/session";
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

  return (
    <html lang={locale} dir={directionOf(locale)}>
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider>
          <header className="flex items-center justify-between border-b border-border px-6 py-3">
            <Link href="/" className="text-lg font-semibold">
              {t("appName")}
            </Link>
            <div className="flex items-center gap-2">
              {me && <SignOutButton />}
              <LanguageSwitch />
            </div>
          </header>
          <main className="mx-auto max-w-3xl px-6 py-10">{children}</main>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
