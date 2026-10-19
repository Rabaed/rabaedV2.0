import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CompanyImages } from "@/components/company-stamp";
import { redirect } from "@/i18n/navigation";
import { getMe, getMyCompany } from "@/lib/session";

/**
 * My Company → Company Profile (RP-617, ADR 0023): the Company's name and registration numbers,
 * and its logo and Stamp, which its Authorized Person uploads and every Member of it sees. In the
 * design kit's Company Profile cards (`RP.profile`, `.pc`, `.co-hd`); an interim screen until the
 * Signature and Stamp design (RP-665, RP-666).
 */
export default async function CompanyProfilePage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("company");
  const [me, company] = await Promise.all([getMe(), getMyCompany()]);
  if (!me) return redirect({ href: "/sign-in", locale });
  const name = company?.company.legalName[locale] ?? me.company.legalName[locale];

  return (
    <div className="max-w-4xl space-y-[18px]">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="font-display text-h4 leading-[1.2] font-extrabold tracking-[-0.01em] text-text rtl:font-bold rtl:tracking-normal">{t("title")}</h1>
        <p className="text-body text-muted">{t("subtitle")}</p>
      </div>
      {!company ? (
        <p role="alert" className="text-danger-fg">
          {t("unavailable")}
        </p>
      ) : (
        <>
          <section aria-label={name} className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface px-5 py-[18px]">
            <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border-subtle bg-surface-subtle text-h5 font-bold text-muted">
              {company.logo ? (
                // eslint-disable-next-line @next/next/no-img-element -- a signed storage link, not a static asset
                <img src={company.logo.image.url} alt="" className="size-full object-contain p-1" />
              ) : (
                <span aria-hidden="true">{name.slice(0, 2)}</span>
              )}
            </span>
            <div className="min-w-0">
              <h2 className="text-h5 font-semibold">{name}</h2>
              <p className="text-sm text-muted">
                {t("crNumber")} <bdi className="font-mono">{company.company.crNumber}</bdi> · {t("vatNumber")}{" "}
                <bdi className="font-mono">{company.company.vatNumber}</bdi>
              </p>
            </div>
          </section>
          <CompanyImages company={company} />
        </>
      )}
    </div>
  );
}
