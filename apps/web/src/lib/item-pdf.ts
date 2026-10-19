import type { SignedUrl, WorkingCopyAnswer } from "@rabaed/domain";

/** Why an item's PDF could not be opened. */
export type ItemPdfProblem = "notFound" | "notReady" | "failed" | "unavailable";

/** The documentalRecord message that tells the viewer why there was no PDF to open. */
export function itemPdfProblemMessage(problem: ItemPdfProblem): "notReady" | "workingCopyFailed" | "unavailable" {
  return problem === "notReady" ? "notReady" : problem === "failed" ? "workingCopyFailed" : "unavailable";
}

/** How often, and how long, the Working Copy is asked for while the worker prints it. */
const POLL_MS = 1500;
const POLL_FOR_MS = 120_000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * "Download PDF" (RP-621; ADR 0023): the link to an item's PDF, through the api's short-lived
 * signed links. An item that isn't closed gives its Working Copy, asked for again while the
 * worker prints it; a closed one (or one that closes meanwhile) gives its Documental Record.
 */
export async function itemPdfLink(workItemId: string, closed: boolean): Promise<{ url: string } | { problem: ItemPdfProblem }> {
  const id = encodeURIComponent(workItemId);
  const record = async () => {
    const res = await fetch(`/api/v1/work-items/${id}/documental-record`);
    if (!res.ok) return { problem: res.status === 404 ? ("notReady" as const) : ("unavailable" as const) };
    return { url: ((await res.json()) as SignedUrl).url };
  };
  if (closed) return record();
  const until = Date.now() + POLL_FOR_MS;
  for (;;) {
    const res = await fetch(`/api/v1/work-items/${id}/working-copy`, { method: "POST" });
    if (!res.ok) return { problem: res.status === 404 ? "notFound" : "unavailable" };
    const answer = (await res.json()) as WorkingCopyAnswer;
    switch (answer.status) {
      case "ready":
        return { url: answer.url };
      case "closed":
        return record();
      case "failed":
        return { problem: "failed" };
      case "preparing":
        if (Date.now() > until) return { problem: "unavailable" };
        await wait(POLL_MS);
    }
  }
}

/**
 * Opens the item's PDF in a new tab: the tab opens at once, so the browser treats it as the
 * click's own window, and the link follows. Returns the problem when there is none to open.
 */
export async function openItemPdf(workItemId: string, closed: boolean): Promise<ItemPdfProblem | null> {
  const opened = window.open("", "_blank");
  // The new tab can't reach back into this page.
  if (opened) opened.opener = null;
  try {
    const link = await itemPdfLink(workItemId, closed);
    if ("problem" in link) {
      opened?.close();
      return link.problem;
    }
    if (opened) opened.location.href = link.url;
    else window.location.href = link.url;
    return null;
  } catch {
    opened?.close();
    return "unavailable";
  }
}
