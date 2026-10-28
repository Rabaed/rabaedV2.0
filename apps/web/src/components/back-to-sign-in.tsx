import { getTranslations } from "next-intl/server";
import { Icon } from "@rabaed/ui";
import { Link } from "@/i18n/navigation";

/** The design's "Back to sign in", above the forgot password pages' title (RP-1058). The arrow points back in either direction. */
export async function BackToSignIn() {
  const t = await getTranslations("passwordReset");
  return (
    <Link href="/sign-in" className="inline-flex items-center gap-1.5 self-start text-[13.5px] font-semibold text-muted hover:text-text">
      <Icon name="arrow-left" size={16} className="rtl:-scale-x-100" />
      {t("back")}
    </Link>
  );
}
