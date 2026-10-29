import type { Locale } from "@rabaed/domain";
import { getLocale, getTranslations } from "next-intl/server";
import Image from "next/image";
import type { ReactNode } from "react";
import { LanguageChoice } from "@/components/language-choice";
import { SignInShowcase } from "@/components/sign-in-showcase";
import { legalLinks } from "@/lib/sign-in-check";

/**
 * The owner's sign-in design (RP-1057): the form on the reading-start side, the dark brand panel on the
 * other (hidden on narrow screens). Sign-in draws it, and so do asking for and using a reset link
 * (RP-1058); the layout leaves out the signed-out header for them (`hasOwnFrame`).
 */
export async function SignInFrame({ children }: { children: ReactNode }) {
  const t = await getTranslations("signIn");
  const app = await getTranslations("shell");
  const locale = (await getLocale()) as Locale;
  return (
    <div className="grid min-h-dvh bg-surface min-[961px]:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col p-5 min-[961px]:px-12 min-[961px]:py-7">
        <header className="flex items-center gap-3">
          <Image src="/brand/rabaed-logo.svg" alt={app("appName")} width={120} height={40} unoptimized priority className="h-10 w-auto" />
          <LanguageChoice className="ms-auto" />
        </header>
        <main className="flex flex-1 items-center justify-center py-10">
          <div className="flex w-full max-w-100 flex-col gap-5">{children}</div>
        </main>
        <footer className="flex flex-wrap items-center gap-4 text-[12.5px] text-faint">
          <span className="me-auto">{t("copyright", { year: String(new Date().getFullYear()) })}</span>
          {/* The design's Privacy and Terms, on the marketing site (owner, 2026-10-30); it has no Help page yet. */}
          <nav aria-label={t("legal.label")} className="flex gap-4">
            {legalLinks(locale).map(({ key, href }) => (
              <a key={key} href={href} target="_blank" rel="noopener" className="font-medium text-muted hover:text-brand-fg hover:underline">
                {t(`legal.${key}`)}
              </a>
            ))}
          </nav>
        </footer>
      </div>
      <SignInShowcase />
    </div>
  );
}

/** The design's page title: 32px display bold (26px on a phone). */
export function SignInTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="font-display text-[26px] leading-[1.15] font-bold tracking-[-0.02em] text-balance min-[441px]:text-h3 min-[441px]:leading-[1.15] rtl:tracking-normal">
      {children}
    </h1>
  );
}

/** The design's subtitle under the title: 15px, muted. */
export function SignInSubtitle({ children }: { children: ReactNode }) {
  return <p className="-mt-2 text-[15px] leading-normal text-pretty text-muted">{children}</p>;
}
