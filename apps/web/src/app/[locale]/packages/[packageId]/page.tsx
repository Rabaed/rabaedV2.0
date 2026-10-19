import type { Locale } from "@rabaed/domain";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { PackageCommentsView } from "@/components/package-comments-view";
import { PackageView } from "@/components/package-view";
import { redirect } from "@/i18n/navigation";
import { getMe, getPackage, getPackageComments } from "@/lib/session";

/**
 * One Package (RP-659, spec RP-616), at the path its notifications and emails link to
 * (RP-643). One the Member can't see is not found, exactly like one that doesn't exist
 * (visibility.md "Packages"). Its submittals come once, all of them, with the Package
 * (`GET /v1/packages/:id`): each as the List gives it, the latest Revision of each chain the
 * Member sees (story 30), with what the table reads around them.
 */
export default async function PackagePage({ params }: { params: Promise<{ locale: Locale; packageId: string }> }) {
  const { locale, packageId } = await params;
  setRequestLocale(locale);
  // Its Comments (RP-662): the ones the Member sees, for information.
  const [me, pkg, comments] = await Promise.all([getMe(), getPackage(packageId), getPackageComments(packageId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!pkg) notFound();

  return (
    <>
      <PackageView pkg={pkg} locale={locale} />
      <PackageCommentsView comments={comments?.comments ?? []} locale={locale} />
    </>
  );
}
