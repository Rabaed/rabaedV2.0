"use client";

import type { LinkSearchResults, LinkTarget, Locale, WorkItemLink, WorkItemLinks as Links } from "@rabaed/domain";
import { LinksSection } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Link, useRouter } from "@/i18n/navigation";

// The Links System Field, below the Form (form-engine.md part 2b): the item's
// Links as the API returns them for the viewer, a linked item they can't see by
// its number and Subject only (E1). The raiser's Company adds free Links with
// Link search and removes them until Submit; the page is refreshed after a
// change, so the list comes back from the API.

const refusals: Record<string, string> = {
  target_not_found: "targetNotFound",
  already_linked: "alreadyLinked",
  not_editable: "notEditable",
  project_closed: "projectClosed",
};

export function WorkItemLinks({
  workItemId,
  projectId,
  list,
  locale,
}: {
  workItemId: string;
  projectId: string;
  list: Links;
  locale: Locale;
}) {
  const t = useTranslations("workItems.links");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const search = async (q: string, page: number): Promise<LinkSearchResults> => {
    const query = new URLSearchParams({ q, page: String(page) });
    const res = await fetch(`/api/v1/projects/${projectId}/work-items/link-search?${query.toString()}`);
    if (!res.ok) throw new Error(`Link search: ${res.status}`);
    return (await res.json()) as LinkSearchResults;
  };

  async function change(request: () => Promise<Response>) {
    setMessage(null);
    setPending(true);
    try {
      const res = await request();
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage(t(refusals[body.error ?? ""] ?? "unavailable"));
      }
      router.refresh();
    } catch {
      setMessage(t("unavailable"));
    } finally {
      setPending(false);
    }
  }

  const base = `/api/v1/work-items/${workItemId}/links`;
  return (
    <LinksSection
      locale={locale}
      links={list.links}
      canChange={list.canChange}
      workItemId={workItemId}
      search={search}
      onAdd={(target: LinkTarget) =>
        void change(() =>
          fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workItemId: target.id }) }),
        )
      }
      onRemove={(link: WorkItemLink) => void change(() => fetch(`${base}/${link.id}`, { method: "DELETE" }))}
      hrefFor={(id) => `/work-items/${id}`}
      linkAs={Link}
      pending={pending}
      message={message}
    />
  );
}
