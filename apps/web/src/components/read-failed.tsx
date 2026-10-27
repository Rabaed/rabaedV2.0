import { ErrorState } from "@rabaed/ui";
import { getTranslations } from "next-intl/server";
import { TryAgainButton } from "./try-again-button.tsx";

/**
 * In place of a page whose api read was slow or failed (RP-1049): it says so and offers Try
 * again, and is never the not-found page, which means hidden or missing (docs/visibility.md,
 * Direct URL row). It reads nothing about the request, so it names no item, Project or Company.
 */
export async function ReadFailed() {
  const t = await getTranslations("readFailed");
  return (
    <ErrorState title={t("title")} action={<TryAgainButton label={t("tryAgain")} />}>
      {t("body")}
    </ErrorState>
  );
}
