"use client";

import type { CompanyImageKind, Locale, MyCompany, SaveCompanyImageRequest } from "@rabaed/domain";
import { buttonVariants, CompanyImages as CompanyImagesView, StampRequiredDialog, type CompanyImagesLabels, type SaveCompanyImageCall } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import type { Reading } from "@/lib/transition-gate";
import { useApiRead } from "@/lib/use-api-read";

// The Company's logo and Stamp (RP-617, ADR 0023): the Company profile's cards, which its
// Authorized Person uploads them in, and the message a Member whose Company has no Stamp gets
// when they open a Transition, before its Action Form.

function useImagesLabels(): CompanyImagesLabels {
  const t = useTranslations("company");
  const card = (kind: CompanyImageKind) => ({
    title: t(`${kind}.title`),
    badge: t(`${kind}.badge`),
    none: t(`${kind}.none`),
    upload: t(`${kind}.upload`),
    replace: t(`${kind}.replace`),
    fileHelp: t(`${kind}.fileHelp`),
    imageAlt: t(`${kind}.imageAlt`),
  });
  return {
    logo: card("logo"),
    stamp: card("stamp"),
    noStamp: t("noStamp"),
    kept: t("kept"),
    saving: t("saving"),
    refusals: {
      file_type: t("refusals.file_type"),
      file_too_large: t("refusals.file_too_large"),
      invalid_company_image: t("refusals.invalid_company_image"),
      forbidden: t("refusals.forbidden"),
      unavailable: t("refusals.unavailable"),
    },
  };
}

/** The logo and Stamp cards, saved through the API (PUT /v1/companies/:id/:kind); the page reads them again after each. */
export function CompanyImages({ company }: { company: MyCompany }) {
  const router = useRouter();
  const upload: SaveCompanyImageCall = async (kind: CompanyImageKind, image: SaveCompanyImageRequest) => {
    const res = await fetch(`/api/v1/companies/${encodeURIComponent(company.company.id)}/${kind}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(image),
    });
    if (!res.ok) {
      const { error } = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, reason: error ?? "unavailable" };
    }
    router.refresh();
    return { ok: true };
  };
  return (
    <CompanyImagesView
      labels={useImagesLabels()}
      logo={company.logo?.image ?? null}
      stamp={company.stamp?.image ?? null}
      canManage={company.canManage}
      onUpload={upload}
    />
  );
}

/** The signed-in Member's own Company profile, read when `enabled`: loading until answered, or failed. */
export function useMyCompanyRead(enabled: boolean): Reading<MyCompany> {
  return useApiRead<MyCompany>("/v1/me/company", enabled);
}

/** The signed-in Member's own Company profile, read when `enabled`: null until answered, or when unavailable. */
export function useMyCompany(enabled: boolean): MyCompany | null {
  const reading = useMyCompanyRead(enabled);
  return reading.state === "loaded" ? reading.value : null;
}

/**
 * The message a Member whose Company has no Stamp gets when they open a Transition, before its
 * Action Form: it names only their own Company, and gives its Authorized Person the way to the
 * Company profile. Shown once `company` is known.
 */
export function StampRequired({ open, onOpenChange, company }: { open: boolean; onOpenChange: (open: boolean) => void; company: MyCompany | null }) {
  const t = useTranslations("company.required");
  const locale = useLocale() as Locale;
  if (!company) return null;
  const name = company.company.legalName[locale];
  const authorizedPerson = company.canManage;
  return (
    <StampRequiredDialog
      open={open}
      onOpenChange={onOpenChange}
      labels={{
        title: authorizedPerson ? t("authorizedPersonTitle", { company: name }) : t("memberTitle", { company: name }),
        body: authorizedPerson ? t("authorizedPersonBody", { company: name }) : t("memberBody", { company: name }),
        dismiss: authorizedPerson ? t("notNow") : t("ok"),
        close: t("close"),
      }}
      addStamp={
        authorizedPerson ? (
          <Link href="/company" className={buttonVariants()}>
            {t("addStamp")}
          </Link>
        ) : undefined
      }
    />
  );
}
