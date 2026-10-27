import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { root } from "./browser.ts";
import { Api, projectIdOf } from "./helpers.ts";
import { demoPdf } from "../../../../apps/api/src/demo/demo-pdf.ts";
import { jpegWithExif } from "../../../../apps/api/src/demo/exif-jpeg.ts";

// Helpers of the SUB, WF and FRM cases (Parts SUB, WF, FRM): the people's api sessions, the Project's
// ids, and the MAR / SAR / DAR flows driven through the api exactly as the web app drives them.

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- api answers are read loosely by the cases
export type Json = Record<string, any>;

/** A small real JPEG (96 x 64) as the demo seed's Sample photo, read from the seed. */
function samplePhoto(): Buffer {
  const seed = readFileSync(resolve(root, "apps/api/src/demo/seed.ts"), "utf8");
  const m = /SAMPLE_PHOTO_JPEG =\s*"([A-Za-z0-9+/=]+)"/.exec(seed);
  return m ? Buffer.from(m[1]!, "base64") : Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
}

export const pdfFile = (...lines: string[]) => demoPdf(lines.length ? lines : ["UAT datasheet", "Made up for the UAT round."]);
export const exifJpeg = () => jpegWithExif({ takenAt: "2026:09:28 10:15:00", offset: "+03:00", latitude: 24.7136, longitude: 46.6753 }, samplePhoto());

export type Team = { api: Record<string, Api>; projectId: string; d: Dims };
export type Dims = {
  trade: (name: string) => string;
  loc: (name: string) => string;
  raw: { trade: Json[]; location: Json[] };
  scopes: (tradeId: string) => Promise<Json[]>;
  suppliers: (tradeId: string) => Promise<Json[]>;
};

/** Signed-in api sessions for the named people (a new browser context each; the runner closes them after the case). */
export async function team(...names: string[]): Promise<Team> {
  const api: Record<string, Api> = {};
  for (const n of names) api[n] = await Api.as(n);
  const first = api[names[0]!]!;
  const projectId = (await projectIdOf(first))!;
  const dims = (await first.get(`/projects/${projectId}/dimensions`)).body as { trade: Json[]; location: Json[] };
  const find = (list: Json[], name: string) => {
    const x = list.find((l) => l.name.en === name || l.name.en.startsWith(name));
    if (!x) throw new Error(`No dimension value "${name}"`);
    return x.id as string;
  };
  const d: Dims = {
    trade: (n) => find(dims.trade, n),
    loc: (n) => find(dims.location, n),
    raw: dims,
    scopes: async (tradeId) => ((await first.get(`/projects/${projectId}/scopes?tradeId=${tradeId}`)).body as Json).scopes,
    suppliers: async (tradeId) => ((await first.get(`/projects/${projectId}/approved-suppliers?tradeId=${tradeId}`)).body as Json).suppliers,
  };
  return { api, projectId, d };
}

export async function supplierId(tm: Team, tradeName: string, supplierName: string): Promise<string> {
  const list = await tm.d.suppliers(tm.d.trade(tradeName));
  const s = list.find((x) => x.name.en.toLowerCase() === supplierName.toLowerCase());
  if (!s) throw new Error(`No approved supplier "${supplierName}" for ${tradeName}`);
  return s.id;
}

/** The MAR Form's answers for a complete MAR (everything but the Datasheet file). */
export async function marAnswers(tm: Team, over: Json = {}): Promise<Json> {
  return {
    manufacturer: "Philips",
    supplier: await supplierId(tm, "Electrical Works", "Najd Electrical Supplies"),
    model: "CoreLine Panel",
    specification_section: "26 51 00",
    description: "UAT made-up luminaires for the escape routes.",
    items: [
      { fixture_type: "Recessed panel", description: "", quantity: 200, unit: "pcs" },
      { fixture_type: "Surface panel", description: "", quantity: 40, unit: "pcs" },
    ],
    trade: tm.d.trade("Electrical Works"),
    location: tm.d.loc("Tower 1 Floor 02"),
    ...over,
  };
}

export async function createItem(api: Api, tm: Team, type: "MAR" | "SAR" | "DAR", title: string, answers: Json): Promise<string> {
  const r = await api.post(`/projects/${tm.projectId}/work-items`, { type, title, answers });
  if (r.status !== 201) throw new Error(`create ${type} "${title}" answered ${r.status}: ${r.text.slice(0, 300)}`);
  return (r.body as Json).id as string;
}

/** Uploads a file the way the browser does: signed URL, the bytes, then confirm. Returns the Document id. */
export async function upload(api: Api, id: string, file: { fieldKey?: string; fileName: string; contentType: string; body: Buffer }): Promise<string> {
  const { body, ...start } = file;
  const s = await api.post(`/work-items/${id}/documents`, { ...start, sizeBytes: body.byteLength });
  if (s.status !== 201) throw new Error(`upload start ${file.fileName} answered ${s.status}: ${s.text.slice(0, 300)}`);
  const started = s.body as Json;
  const put = await fetch(started.upload.url, { method: started.upload.method, headers: started.upload.headers, body });
  if (!put.ok) throw new Error(`the file store answered ${put.status} to ${file.fileName}`);
  const c = await api.post(`/work-items/${id}/documents/${started.id}/confirm`);
  if (c.status >= 300) throw new Error(`upload confirm answered ${c.status}: ${c.text.slice(0, 300)}`);
  return started.id as string;
}

export const addDatasheet = (api: Api, id: string, name = "UAT-datasheet.pdf") => upload(api, id, { fieldKey: "datasheet", fileName: name, contentType: "application/pdf", body: pdfFile("UAT datasheet", name) });
export const addPhoto = (api: Api, id: string, name = "UAT-sample.jpg") => upload(api, id, { fieldKey: "sample_photo", fileName: name, contentType: "image/jpeg", body: exifJpeg() });

export async function detail(api: Api, id: string): Promise<Json> {
  const r = await api.get(`/work-items/${id}`);
  if (r.status !== 200) throw new Error(`GET work item ${id} answered ${r.status}: ${r.text.slice(0, 200)}`);
  return r.body as Json;
}

export const offered = (d: Json): string[] => d.actions.transitions.map((t: Json) => t.key);

/** Takes a Transition; returns the reply (so a refusal can be read). */
export function move(api: Api, id: string, transition: string, extra: Json = {}) {
  return api.transition(id, transition, extra);
}

/** Takes a Transition and throws when refused. */
export async function must(api: Api, id: string, transition: string, extra: Json = {}): Promise<void> {
  const r = await move(api, id, transition, extra);
  if (r.status >= 300) throw new Error(`${api.person} ${transition} on ${id} answered ${r.status}: ${r.text.slice(0, 300)}`);
}

export const pickUp = (api: Api, id: string) => api.post(`/work-items/${id}/pick-up`);

/** A complete MAR sent for review, in TMC's Internal Review with Ali. Returns its id. */
export async function sentMar(tm: Team, title: string, over: Json = {}): Promise<string> {
  const hafiz = tm.api.hafiz!;
  const id = await createItem(hafiz, tm, "MAR", title, await marAnswers(tm, over));
  await addDatasheet(hafiz, id);
  await must(hafiz, id, "send_for_review");
  return id;
}

/** A MAR Submitted to the Consultant (Ali holds, Submits with a Cover Note). */
export async function submittedMar(tm: Team, title: string, over: Json = {}, coverNote = "UAT cover note for the panels."): Promise<string> {
  const id = await sentMar(tm, title, over);
  const ali = tm.api.ali!;
  await pickUp(ali, id);
  await must(ali, id, "submit", { answers: { cover_note: coverNote }, internalNote: "UAT internal note: quantities checked." });
  return id;
}

/** Ahmed picks up and sends to Manager with a verification; Mohammed holds it. */
export async function reviewedMar(tm: Team, id: string, verification: Json = { sample_checked: true, matches_specification: true }, recommended = "A", internalNote = "UAT engineer note."): Promise<void> {
  const ahmed = tm.api.ahmed!;
  await pickUp(ahmed, id);
  await must(ahmed, id, "send_to_manager", { answers: verification, recommendedCode: recommended, internalNote });
  await pickUp(tm.api.mohammed!, id);
}

/** Text of the whole item history as a string, for pattern checks. */
export async function historyText(api: Api, id: string): Promise<string> {
  const r = await api.get(`/work-items/${id}/history`);
  return r.text;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The Submittals List rows via api: id, title, number, stage, with. */
export async function listItems(api: Api, projectId: string, query = ""): Promise<Json[]> {
  const r = await api.get(`/projects/${projectId}/work-items${query ? `?${query}` : ""}`);
  return ((r.body as Json)?.items ?? []) as Json[];
}

export const stamp = () => new Date().toISOString().slice(11, 19).replaceAll(":", "");

import type { Page } from "playwright";
import { pageAs, type Locale } from "./browser.ts";
import { go, settle } from "./helpers.ts";
import type { CaseApi } from "./case.ts";

/** Opens an item page as `person`, shoots it (when `what`), and returns the page and the main text. */
export async function viewItem(t: CaseApi, person: string, id: string, what?: string, locale: Locale = "en", opts: { phone?: boolean; full?: boolean } = {}): Promise<{ page: Page; text: string }> {
  const { page } = await pageAs(person, { locale, phone: opts.phone });
  await go(page, `/work-items/${id}`, locale);
  await settle(page);
  if (what) await t.shot(page, what, { fullPage: opts.full ?? false });
  return { page, text: (await page.locator("main").innerText()).replace(/[ \t]+/g, " ") };
}

/** Opens a page path as `person`, shoots it, returns page and main text. */
export async function viewPath(t: CaseApi, person: string, path: string, what?: string, locale: Locale = "en", opts: { phone?: boolean; full?: boolean } = {}): Promise<{ page: Page; text: string }> {
  const { page } = await pageAs(person, { locale, phone: opts.phone });
  await go(page, path, locale);
  await settle(page);
  if (what) await t.shot(page, what, { fullPage: opts.full ?? false });
  return { page, text: (await page.locator("main").innerText()).replace(/[ \t]+/g, " ") };
}

export const eventsOf = async (api: Api, id: string): Promise<Json[]> => (((await api.get(`/work-items/${id}/history`)).body as Json)?.events ?? []) as Json[];
export const NUMBER_RE = /^TWR-MAR-01-\d{4}$/;
