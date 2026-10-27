/* eslint-disable @typescript-eslint/no-explicit-any -- UAT scripts read api answers as loose JSON */
import type { Page } from "playwright";
import { jpegWithExif } from "../../../../apps/api/src/demo/exif-jpeg.ts";
import { demoPdf } from "../../../../apps/api/src/demo/demo-pdf.ts";
import { mailpitUrl, pageAs, urlOf } from "./browser.ts";
import { Api, projectIdOf, type ApiReply } from "./helpers.ts";

// Helpers for the VIS and PAR cases (written by the VIS/PAR agent; the shared harness files are untouched).
// Everything here goes through the api as the seeded people, as the web app does, except the pages
// a case looks at on purpose.

export type Dims = { trade: Record<string, string>; location: Record<string, string> };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export { sleep };

/** A crew of signed-in api callers for one case: each person once, the Project and its Trades and Locations by code. */
export class Crew {
  readonly apis = new Map<string, Api>();
  projectId = "";
  dims: Dims = { trade: {}, location: {} };

  static async start(): Promise<Crew> {
    const crew = new Crew();
    const saeed = await crew.as("saeed");
    const id = await projectIdOf(saeed);
    if (!id) throw new Error("Saeed does not see the Project.");
    crew.projectId = id;
    const d = (await saeed.get(`/projects/${id}/dimensions`)).body as { trade: { id: string; code: string }[]; location: { id: string; code: string }[] };
    crew.dims = { trade: Object.fromEntries(d.trade.map((t) => [t.code, t.id])), location: Object.fromEntries(d.location.map((t) => [t.code, t.id])) };
    return crew;
  }

  async as(person: string): Promise<Api> {
    let api = this.apis.get(person);
    if (!api) {
      api = await Api.as(person);
      this.apis.set(person, api);
    }
    return api;
  }
}

export function must<T = unknown>(reply: ApiReply, what: string): T {
  if (reply.status >= 400) throw new Error(`${what} answered ${reply.status}: ${reply.text.slice(0, 300)}`);
  return reply.body as T;
}

// ---- Files ----

export const pdfBytes = (...lines: string[]) => demoPdf(lines.length ? lines : ["UAT datasheet", "made up"]);
export const photoBytes = (exif = { takenAt: "2026:10:20 09:30:00", offset: "+03:00", latitude: 24.7136, longitude: 46.6753 }) => jpegWithExif(exif);

export type UploadedDoc = { id: string };

/** The three upload steps of a Document: a signed URL, the bytes, the confirm. Returns the id; throws on a refusal. */
export async function upload(api: Api, itemId: string, file: { fieldKey?: string; fileName: string; contentType: string; body: Buffer; itemKey?: string; annotatedFromId?: string }): Promise<UploadedDoc> {
  const { body, ...start } = file;
  const started = must<{ id: string; upload: { url: string; method: string; headers: Record<string, string> } }>(
    await api.post(`/work-items/${itemId}/documents`, { ...start, sizeBytes: body.byteLength }),
    "start upload",
  );
  const put = await fetch(started.upload.url, { method: started.upload.method, headers: started.upload.headers, body });
  if (!put.ok) throw new Error(`The file store answered ${put.status} to ${file.fileName}`);
  must(await api.post(`/work-items/${itemId}/documents/${started.id}/confirm`), "confirm upload");
  return { id: started.id };
}

/** Tries an upload and returns the status of the first refusal (404 expected for the hidden), or 201 when it was accepted. */
export async function tryStartUpload(api: Api, itemId: string, fileName = "UAT-try.pdf"): Promise<number> {
  const body = pdfBytes("try");
  return (await api.post(`/work-items/${itemId}/documents`, { fieldKey: "datasheet", fileName, sizeBytes: body.byteLength, contentType: "application/pdf" })).status;
}

// ---- Items ----

export type MarOptions = { trade?: string; location?: string; answers?: Record<string, unknown>; type?: "MAR" | "SAR" | "DAR" };

let najdCache: Record<string, string> = {};
export async function supplierFor(api: Api, projectId: string, tradeId: string): Promise<string> {
  if (najdCache[tradeId]) return najdCache[tradeId]!;
  const reply = must<{ suppliers: { id: string; name: { en: string }; status?: string }[] }>(await api.get(`/projects/${projectId}/approved-suppliers?tradeId=${tradeId}`), "approved suppliers");
  const najd = reply.suppliers.find((s) => /Najd|Tabuk/.test(s.name.en)) ?? reply.suppliers[0];
  if (!najd) throw new Error("No approved supplier for the Trade.");
  najdCache = { ...najdCache, [tradeId]: najd.id };
  return najd.id;
}

/** Hafiz (or `who`) saves a Draft MAR with a datasheet; returns its id. */
export async function createMar(crew: Crew, subject: string, options: MarOptions & { who?: string; noDatasheet?: boolean } = {}): Promise<string> {
  const who = await crew.as(options.who ?? "hafiz");
  const trade = crew.dims.trade[options.trade ?? "EL"]!;
  const location = crew.dims.location[options.location ?? "T2F01"]!;
  const supplier = await supplierFor(who, crew.projectId, trade);
  const created = must<{ id: string }>(
    await who.post(`/projects/${crew.projectId}/work-items`, {
      type: "MAR",
      title: subject,
      answers: {
        manufacturer: "UAT Maker",
        supplier,
        model: "UAT-1",
        description: `${subject}: made up for the UAT run.`,
        items: [{ fixture_type: "UAT fixture", description: "made up", quantity: 3, unit: "pcs" }],
        trade,
        location,
        ...options.answers,
      },
    }),
    "create MAR",
  );
  if (!options.noDatasheet) await upload(who, created.id, { fieldKey: "datasheet", fileName: "UAT-datasheet.pdf", contentType: "application/pdf", body: pdfBytes(subject, "Made up for the UAT run.") });
  return created.id;
}

export async function take(api: Api, itemId: string, transition: string, extra: Record<string, unknown> = {}): Promise<ApiReply> {
  return api.transition(itemId, transition, extra);
}

export async function takeOk(api: Api, itemId: string, transition: string, extra: Record<string, unknown> = {}): Promise<void> {
  must(await api.transition(itemId, transition, extra), `${api.person} ${transition}`);
}

export async function pickUp(api: Api, itemId: string): Promise<ApiReply> {
  return api.post(`/work-items/${itemId}/pick-up`);
}

/** Hafiz sends for review; Ali picks it up and holds it (internal review at TMC). */
export async function sendForReview(crew: Crew, itemId: string, who = "hafiz", note = ""): Promise<void> {
  const hafiz = await crew.as(who);
  await takeOk(hafiz, itemId, "send_for_review", note ? { internalNote: note } : {});
  const ali = await crew.as("ali");
  await pickUp(ali, itemId);
}

/** Ali Submits to the Consultant with a Cover Note. */
export async function aliSubmit(crew: Crew, itemId: string, note = ""): Promise<void> {
  const ali = await crew.as("ali");
  await pickUp(ali, itemId);
  await takeOk(ali, itemId, "submit", { answers: { cover_note: "UAT cover note." }, ...(note ? { internalNote: note } : {}) });
}

/** A MAR from Draft to Submitted (with DCL). */
export async function submittedMar(crew: Crew, subject: string, options: MarOptions & { who?: string; internalNote?: string } = {}): Promise<string> {
  const id = await createMar(crew, subject, options);
  await sendForReview(crew, id, options.who ?? "hafiz");
  await aliSubmit(crew, id, options.internalNote ?? "");
  return id;
}

/** Ahmed picks up and sends to Manager with a verification, a Recommended Code and an Internal Note; Mohammed holds it. */
export async function ahmedSendsToManager(crew: Crew, itemId: string, recommended = "A", note = "UAT Ahmed internal note", who = "ahmed"): Promise<void> {
  const ahmed = await crew.as(who);
  await pickUp(ahmed, itemId);
  await takeOk(ahmed, itemId, "send_to_manager", {
    answers: { sample_checked: true, matches_specification: true, verification_note: "UAT verification note (internal)." },
    recommendedCode: recommended,
    internalNote: note,
  });
  const mohammed = await crew.as("mohammed");
  await pickUp(mohammed, itemId);
}

/** Mohammed issues a Code with answers. */
export async function mohammedCodes(crew: Crew, itemId: string, transition: string, answers: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Promise<ApiReply> {
  const mohammed = await crew.as("mohammed");
  return mohammed.transition(itemId, transition, { answers: { sample_checked: true, matches_specification: true, ...answers }, ...extra });
}

/** The item as a person reads it: `{status, body}`. */
export async function detail(api: Api, itemId: string): Promise<ApiReply> {
  return api.get(`/work-items/${itemId}`);
}

export type Row = { id: string; title: string; documentNumber: string | null; stage: { key: string; name: { en: string } }; with: { kind: string; companyName: { en: string }; step?: { key: string; name: { en: string } }; holder?: { name: { en: string } } | null } | null; revisionNo: number; outcome: string | null; creationDate: string | null; submissionDate: string | null; stepAgeWeeks: number | null; trade: { code: string }; location: { code: string } | null; raiserCompanyName?: { en: string }; closedBy?: unknown };

/** One page of the List as the person reads it. `query` is the raw query string (without the ?). */
export async function listOf(api: Api, projectId: string, query = "", module = "", allRevisions = true): Promise<{ status: number; items: Row[]; stages: { key: string; count: number }[]; filters: Record<string, any>; text: string }> {
  const path = module ? `/projects/${projectId}/modules/${module}/work-items` : `/projects/${projectId}/work-items`;
  const reply = await api.get(`${path}?pageSize=50${allRevisions ? "&allRevisions=true" : ""}${query ? `&${query}` : ""}`);
  const b = (reply.body ?? {}) as { items?: Row[]; stages?: { key: string; count: number }[]; filters?: Record<string, any> };
  return { status: reply.status, items: b.items ?? [], stages: b.stages ?? [], filters: b.filters ?? {}, text: reply.text };
}

/** Every row of the List across its pages. */
export async function listAll(api: Api, projectId: string, query = "", module = ""): Promise<Row[]> {
  const rows: Row[] = [];
  for (let page = 1; page <= 40; page++) {
    const path = module ? `/projects/${projectId}/modules/${module}/work-items` : `/projects/${projectId}/work-items`;
    const reply = await api.get(`${path}?pageSize=50&allRevisions=true&page=${page}${query ? `&${query}` : ""}`);
    const b = (reply.body ?? {}) as { items?: Row[]; page?: { hasNext: boolean } };
    rows.push(...(b.items ?? []));
    if (!b.page?.hasNext) break;
  }
  return rows;
}

/** The List's total count (all stages) as the person reads it. */
export async function listTotal(api: Api, projectId: string, query = "", module = ""): Promise<number> {
  const l = await listOf(api, projectId, query, module);
  return l.stages.reduce((n, s) => n + s.count, 0);
}

/** Search the List for a phrase; returns the matching rows. */
export async function searchRows(api: Api, projectId: string, q: string, module = ""): Promise<Row[]> {
  return (await listOf(api, projectId, `q=${encodeURIComponent(q)}`, module)).items;
}

export const stageCounts = (l: { stages: { key: string; count: number }[] }) => Object.fromEntries(l.stages.map((s) => [s.key, s.count]));

// ---- Leak probe ----

export type Probe = { channel: string; leaked: boolean; detail: string };

const ITEM_PATHS = (id: string) => [
  `/work-items/${id}`,
  `/work-items/${id}/documents`,
  `/work-items/${id}/history`,
  `/work-items/${id}/links`,
  `/work-items/${id}/linked-from`,
  `/work-items/${id}/workflow`,
  `/work-items/${id}/revisions`,
  `/work-items/${id}/shared`,
  `/work-items/${id}/form`,
  `/work-items/${id}/watch`,
];

/**
 * Everything a person who must NOT see an item can read, searched for the item: its Subject, number and id.
 * `subject` is the unique "UAT <id> ..." Subject. Returns the channels that leaked.
 */
export async function leakProbe(api: Api, projectId: string, itemId: string, subject: string, extraNeedles: string[] = []): Promise<Probe[]> {
  const probes: Probe[] = [];
  const needles = [subject, itemId, ...extraNeedles];
  const holds = (text: string) => needles.find((n) => n && text.includes(n));
  const channel = async (name: string, path: string) => {
    const reply = await api.get(path);
    const hit = holds(reply.text);
    probes.push({ channel: name, leaked: reply.status === 200 && hit !== undefined, detail: `${reply.status}${hit ? ` contains "${hit}"` : ""}` });
  };
  await channel("List (all revisions)", `/projects/${projectId}/work-items?pageSize=50&allRevisions=true`);
  await channel("List search by Subject", `/projects/${projectId}/work-items?pageSize=50&allRevisions=true&q=${encodeURIComponent(subject)}`);
  await channel("Kanban", `/projects/${projectId}/work-items/kanban`);
  await channel("Dashboard", `/projects/${projectId}/dashboard`);
  await channel("Activity Feed", `/projects/${projectId}/activity`);
  await channel("Bell", `/notifications`);
  await channel("Home", `/home`);
  await channel("Link search", `/projects/${projectId}/work-items/link-search?q=${encodeURIComponent(subject)}`);
  await channel("Export", `/projects/${projectId}/work-items/export?pageSize=50&allRevisions=true`);
  for (const p of ITEM_PATHS(itemId)) {
    const reply = await api.get(p);
    probes.push({ channel: `GET ${p.replace(itemId, ":id")}`, leaked: reply.status !== 404, detail: `${reply.status}` });
  }
  return probes;
}

export const leaked = (probes: Probe[]) => probes.filter((p) => p.leaked);
export const leakSummary = (probes: Probe[]) => (leaked(probes).length ? leaked(probes).map((p) => `${p.channel}: ${p.detail}`).join("; ") : `${probes.length} channels clean`);

/** The 404 page for a path as `person` sees it in the browser (data-testid="not-found"), reusing an open page. */
export async function pageIsNotFound(page: Page, path: string, locale: "en" | "ar" = "en"): Promise<{ notFound: boolean; status: number | undefined; text: string }> {
  const res = await page.goto(urlOf(path, locale), { waitUntil: "networkidle" });
  const marker = page.getByTestId("not-found");
  const notFound = (await marker.count()) > 0;
  return { notFound, status: res?.status(), text: notFound ? (await marker.first().innerText()).replace(/\s+/g, " ").trim() : (await page.locator("main").first().innerText().catch(() => "")).slice(0, 200) };
}

/** Text of the main region of the open page. */
export async function mainText(page: Page): Promise<string> {
  return (await page.locator("main").first().innerText().catch(() => page.locator("body").innerText())).replace(/\s+/g, " ").trim();
}

/** Opens `path` and returns whether the page's visible text holds `needle`. */
export async function pageHolds(page: Page, path: string, needle: string, locale: "en" | "ar" = "en"): Promise<boolean> {
  await page.goto(urlOf(path, locale), { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  return (await page.locator("body").innerText()).includes(needle);
}

/** The signed-in page of a person, a convenience. */
export async function pageFor(person: string, options: { locale?: "en" | "ar"; phone?: boolean } = {}): Promise<Page> {
  return (await pageAs(person, options)).page;
}

// ---- Mail ----

export type Mail = { id: string; to: string[]; subject: string; created: string };

/** All mail to an address that mentions `needle` in its subject or body text. */
export async function mailsWith(address: string, needle: string): Promise<Mail[]> {
  const res = await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}&limit=200`);
  const json = (await res.json()) as { messages?: { ID: string; To: { Address: string }[]; Subject: string; Created: string; Snippet?: string }[] };
  const out: Mail[] = [];
  for (const m of json.messages ?? []) {
    let hit = m.Subject.includes(needle) || (m.Snippet ?? "").includes(needle);
    if (!hit) {
      const full = await fetch(`${mailpitUrl}/api/v1/message/${m.ID}`);
      const text = JSON.stringify(await full.json());
      hit = text.includes(needle);
    }
    if (hit) out.push({ id: m.ID, to: m.To.map((t) => t.Address), subject: m.Subject, created: m.Created });
  }
  return out;
}

// ---- More flow helpers ----

export type TransitionInfo = { key: string; kind: string; label: { en: string } };

/** The Transitions `api` may take on the item now. */
export async function transitionsOf(api: Api, itemId: string): Promise<TransitionInfo[]> {
  return (((await detail(api, itemId)).body as any)?.actions?.transitions ?? []) as TransitionInfo[];
}

/** Picks the item up (if it waits in the Step Pool) and takes the first Transition of that kind. */
export async function takeKind(api: Api, itemId: string, kind: string, answers: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Promise<ApiReply> {
  let tr = (await transitionsOf(api, itemId)).find((x) => x.kind === kind);
  if (!tr) {
    await pickUp(api, itemId);
    tr = (await transitionsOf(api, itemId)).find((x) => x.kind === kind);
  }
  if (!tr) throw new Error(`${api.person} has no ${kind} Transition on the item (has: ${(await transitionsOf(api, itemId)).map((x) => x.key).join(", ") || "none"}).`);
  return api.transition(itemId, tr.key, { answers, ...extra });
}

/** A Draft Snag (Type SNG) raised by `who` on a Location; Contractor side covers it. */
export async function createSnag(crew: Crew, who: string, subject: string, location = "T1F01", trade = "EL"): Promise<string> {
  const api = await crew.as(who);
  const created = must<{ id: string }>(
    await api.post(`/projects/${crew.projectId}/work-items`, {
      type: "SNG",
      title: subject,
      answers: { description: `${subject}: made up for the UAT run.`, trade: crew.dims.trade[trade], location: crew.dims.location[location] },
    }),
    "create Snag",
  );
  return created.id;
}

/** A Snag raised (Draft to Open). */
export async function raiseSnag(crew: Crew, who: string, subject: string, location = "T1F01", trade = "EL"): Promise<string> {
  const id = await createSnag(crew, who, subject, location, trade);
  must(await (await crew.as(who)).transition(id, "raise"), `${who} raise`);
  return id;
}

/** A MAR closed with Code A by the full flow. */
export async function closedMar(crew: Crew, subject: string, options: MarOptions & { code?: "A" | "B" | "C" | "D" } = {}): Promise<string> {
  const id = await submittedMar(crew, subject, options);
  const code = options.code ?? "A";
  await ahmedSendsToManager(crew, id, code);
  const answers: Record<string, unknown> = { verification_note: "UAT final verification." };
  if (code !== "A") answers.remarks = "UAT remarks.";
  if (code === "B") answers.items_to_create = [{ comment: `${subject} comment 1`, reference: "R-1" }];
  const key = { A: "approve_a", B: "approve_b", C: "revise_c", D: "reject_d" }[code];
  must(await mohammedCodes(crew, id, key, answers), `Mohammed issues Code ${code}`);
  return id;
}

/** The status and body text of a GET as `person`, for comparing a hidden answer with a made-up one. */
export async function rawGet(api: Api, path: string): Promise<{ status: number; text: string }> {
  const r = await api.get(path);
  return { status: r.status, text: r.text };
}

export const MADE_UP = "0194e2d0-0000-7000-8000-00000000dead";

export const emailOf: Record<string, string> = {
  saeed: "saeed.alqahtani@tmc.demo.rabaed.test",
  hafiz: "hafiz.hamdan@tmc.demo.rabaed.test",
  ali: "ali.sonour@tmc.demo.rabaed.test",
  omar: "omar.alharbi@tmc.demo.rabaed.test",
  yousef: "yousef.karim@betabuild.demo.rabaed.test",
  nasser: "nasser.aldosari@betabuild.demo.rabaed.test",
  ahmed: "ahmed.binsaid@designconsultants.demo.rabaed.test",
  sara: "sara@designconsultants.demo.rabaed.test",
  mohammed: "mohammed.alshamsi@designconsultants.demo.rabaed.test",
  layla: "layla.mansour@designconsultants.demo.rabaed.test",
  faisal: "faisal.alotaibi@alwaha.demo.rabaed.test",
  noura: "noura.alharbi@alwaha.demo.rabaed.test",
  hind: "hind.almutairi@alwaha.demo.rabaed.test",
};

// ---- Case-level assertions ----

import type { CaseApi } from "./case.ts";

/** Positive control: `person` reads the item in the List (searched by Subject) and by id. */
export async function expectVisible(t: CaseApi, crew: Crew, person: string, itemId: string, subject: string, what = ""): Promise<boolean> {
  const api = await crew.as(person);
  const rows = await searchRows(api, crew.projectId, subject);
  const inList = rows.some((r) => r.id === itemId);
  const d = await detail(api, itemId);
  return t.check(`${person} sees it${what ? ` ${what}` : ""}: in the List and 200 by id`, inList && d.status === 200, `list ${inList ? "has it" : "lacks it"}, by id ${d.status}`);
}

/** Refusal: `person` finds nothing of the item in any channel (lists, counts, search, feed, bell, links, id reads all 404). */
export async function expectHidden(t: CaseApi, crew: Crew, person: string, itemId: string, subject: string, what = "", extraNeedles: string[] = []): Promise<boolean> {
  const api = await crew.as(person);
  const probes = await leakProbe(api, crew.projectId, itemId, subject, extraNeedles);
  return t.check(`${person} sees nothing of it${what ? ` ${what}` : ""}`, leaked(probes).length === 0, leakSummary(probes));
}

/** `person` opens the item page in the browser: the plain not-found page. Shoots it when `shot` is given. */
export async function expectNotFoundPage(t: CaseApi, crew: Crew, person: string, itemId: string, shot?: string, locale: "en" | "ar" = "en"): Promise<boolean> {
  const { context, page } = await pageAs(person, { locale });
  try {
    const nf = await pageIsNotFound(page, `/work-items/${itemId}`, locale);
    if (shot) await t.shot(page, shot);
    return t.check(`${person}: the item URL is the plain not-found page (data-testid not-found)`, nf.notFound, `${nf.status ?? "?"} ${nf.text.slice(0, 80)}`);
  } finally {
    await context.close();
  }
}

/** `person` opens the item page: it shows (not the not-found page) and holds the Subject. Shoots it when `shot` is given. */
export async function expectItemPage(t: CaseApi, crew: Crew, person: string, itemId: string, subject: string, shot?: string): Promise<boolean> {
  const { context, page } = await pageAs(person);
  try {
    const nf = await pageIsNotFound(page, `/work-items/${itemId}`);
    const body = await page.locator("body").innerText();
    if (shot) await t.shot(page, shot);
    return t.check(`${person}: the item page opens with its Subject`, !nf.notFound && body.includes(subject), nf.notFound ? "not-found page" : "page shown");
  } finally {
    await context.close();
  }
}

/** The history events `person` reads, as text and as events. */
export async function historyOf(api: Api, itemId: string): Promise<{ status: number; events: any[]; text: string }> {
  const r = await api.get(`/work-items/${itemId}/history`);
  return { status: r.status, events: ((r.body as any)?.events ?? []) as any[], text: r.text };
}

/** Every person's own Participant visibility (Trade and Location), for the fixtures that must be restored. */
export async function myParticipantId(api: Api, projectId: string): Promise<string> {
  const mine = must<{ participants: { id: string; project: { id: string } }[] }>(await api.get("/participants"), "participations");
  const p = mine.participants.find((x) => x.project.id === projectId);
  if (!p) throw new Error(`${api.person} has no Participant on the Project.`);
  return p.id;
}

export type Grant = { isAll: boolean; valueIds: string[] };
export type Vis = { trade: Grant; location: Grant };

export async function memberIdOf(api: Api, participantId: string, email: string): Promise<string> {
  const members = must<{ members: { id: string; email: string }[] }>(await api.get(`/participants/${participantId}/members`), "members");
  const m = members.members.find((x) => x.email.toLowerCase() === email.toLowerCase());
  if (!m) throw new Error(`${email} is not a Project Member.`);
  return m.id;
}

export async function memberVisibility(api: Api, participantId: string, memberId: string): Promise<Vis> {
  return must<{ visibility: Vis }>(await api.get(`/participants/${participantId}/members/${memberId}/visibility`), "member visibility").visibility;
}
export async function setMemberVisibility(api: Api, participantId: string, memberId: string, v: Vis): Promise<ApiReply> {
  return api.put(`/participants/${participantId}/members/${memberId}/visibility`, v);
}
export async function participantVisibility(api: Api, participantId: string): Promise<Vis> {
  return must<{ visibility: Vis }>(await api.get(`/participants/${participantId}/visibility`), "participant visibility").visibility;
}
export async function setParticipantVisibility(api: Api, participantId: string, v: Vis): Promise<ApiReply> {
  return api.put(`/participants/${participantId}/visibility`, v);
}
export const sameGrant = (a: Grant, b: Grant) => a.isAll === b.isAll && a.valueIds.length === b.valueIds.length && a.valueIds.every((x) => b.valueIds.includes(x));

export async function participantsOfProject(saeed: Api, projectId: string): Promise<{ id: string; name: string; role: string }[]> {
  const b = must<{ participants: { id: string; company: { legalName: { en: string } }; projectRole: { baseRole: string } }[] }>(await saeed.get(`/projects/${projectId}/participants`), "participants");
  return b.participants.map((p) => ({ id: p.id, name: p.company.legalName.en, role: p.projectRole.baseRole }));
}
export async function participantIdByName(saeed: Api, projectId: string, name: string): Promise<string> {
  const p = (await participantsOfProject(saeed, projectId)).find((x) => x.name.includes(name));
  if (!p) throw new Error(`No Participant ${name}`);
  return p.id;
}

// ---- Shared-state care ----

import { readdirSync, statSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { round } from "./browser.ts";

/**
 * Waits until no other case has written a result for `quietMs` (other UAT agents run on the same app), so a
 * Project-wide setting can be switched and switched back without breaking their screens. Gives up after `maxMs`.
 */
export async function quietWindow(quietMs = 90_000, maxMs = 600_000): Promise<boolean> {
  const dir = pathResolve(round, "results", "by-case");
  const started = Date.now();
  for (;;) {
    const now = Date.now();
    const newest = Math.max(0, ...readdirSync(dir).filter((f) => !/^(VIS|PAR)-/.test(f)).map((f) => statSync(pathResolve(dir, f)).mtimeMs));
    if (now - newest > quietMs) return true;
    if (now - started > maxMs) return false;
    await sleep(10_000);
  }
}
