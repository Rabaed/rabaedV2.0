import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Image from "next/image";
import { LanguageChoice } from "@/components/language-choice";
import { SignInShowcase } from "@/components/sign-in-showcase";
import { SignInForm } from "@/components/sign-in-form";

/**
 * The owner's sign-in design (RP-1057): the form on the reading-start side, the dark brand panel on the
 * other (hidden on narrow screens). The page draws its own frame: the layout leaves out the signed-out header.
 */
export default async function SignInPage({ params }: { params: Promise<{ locale: Locale }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations("signIn");
  const app = await getTranslations("shell");
  return (
    <div className="grid min-h-dvh bg-surface min-[961px]:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col p-5 min-[961px]:px-12 min-[961px]:py-7">
        <header className="flex items-center gap-3">
          <Image src="/brand/rabaed-logo.svg" alt={app("appName")} width={120} height={40} unoptimized priority className="h-10 w-auto" />
          <LanguageChoice className="ms-auto" />
        </header>
        <main className="flex flex-1 items-center justify-center py-10">
          <div className="flex w-full max-w-100 flex-col gap-5">
            <h1 className="font-display text-[26px] leading-[1.15] font-bold tracking-[-0.02em] text-balance min-[441px]:text-h3 min-[441px]:leading-[1.15] rtl:tracking-normal">
              {t("title")}
            </h1>
            <p className="-mt-2 text-[15px] leading-normal text-pretty text-muted">{t("subtitle")}</p>
            <SignInForm />
            <p className="text-center text-body text-muted">{t("invite")}</p>
          </div>
        </main>
        <footer className="text-caption text-faint">{t("copyright", { year: String(new Date().getFullYear()) })}</footer>
      </div>
      <SignInShowcase />
    </div>
  );
}
