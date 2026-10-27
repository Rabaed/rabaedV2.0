import { Api, projectIdOf, type ApiReply } from "./helpers.ts";

// Helpers for the NOT, I18N, ADM and SIG cases: make a MAR through the api as the demo people and
// take it along the MAR Workflow. Everything here is made through the same api the web uses.

/** A tiny valid one-page PDF (the datasheet of a MAR). */
export function tinyPdf(text = "UAT datasheet: made up for the UAT round"): Buffer {
  const content = `BT /F1 12 Tf 40 700 Td (${text.replace(/[()\\]/g, "")}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

export type MarContext = { projectId: string; trade: string; location: string; supplier: string };

/** The ids a MAR needs: Electrical Trade, a Tower 1 Location (or the first one found), an Electrical approved supplier. */
export async function marContext(api: Api, tower: 1 | 2 = 2): Promise<MarContext> {
  const projectId = (await projectIdOf(api))!;
  const dims = (await api.get(`/projects/${projectId}/dimensions`)).body as { trade: { id: string; code: string }[]; location: { id: string; code: string }[] };
  const trade = dims.trade.find((x) => x.code === "EL")?.id;
  const location = dims.location.find((x) => x.code === `T${tower}F01`)?.id;
  if (!trade || !location) throw new Error("No Electrical Trade or Location found in the Project's dimensions.");
  const suppliers = (await api.get(`/projects/${projectId}/approved-suppliers?tradeId=${trade}`)).body as { suppliers: { id: string; name: { en: string } }[] };
  const supplier = suppliers.suppliers.find((s) => /Najd/.test(s.name.en))?.id ?? suppliers.suppliers[0]?.id;
  if (!supplier) throw new Error("No Electrical approved supplier found.");
  return { projectId, trade, location, supplier };
}

/** Uploads a file to a Work Item's field: signed URL from the api, the file, then confirm. */
export async function uploadFile(api: Api, itemId: string, fieldKey: string, fileName: string, contentType: string, body: Buffer): Promise<void> {
  const started = await api.post(`/work-items/${itemId}/documents`, { fieldKey, fileName, contentType, sizeBytes: body.byteLength });
  if (started.status >= 300) throw new Error(`Document upload start answered ${started.status}: ${started.text.slice(0, 200)}`);
  const s = started.body as { id: string; upload: { url: string; method: string; headers: Record<string, string> } };
  const put = await fetch(s.upload.url, { method: s.upload.method, headers: s.upload.headers, body: new Uint8Array(body) });
  if (!put.ok) throw new Error(`File store answered ${put.status}`);
  const done = await api.post(`/work-items/${itemId}/documents/${s.id}/confirm`);
  if (done.status >= 300) throw new Error(`Document confirm answered ${done.status}: ${done.text.slice(0, 200)}`);
}

/** Hafiz (or `api`'s person) creates a MAR Draft with its datasheet. Returns the item id. */
export async function makeMar(api: Api, ctx: MarContext, title: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await api.post(`/projects/${ctx.projectId}/work-items`, {
    type: "MAR",
    title,
    answers: {
      manufacturer: "UAT Maker",
      supplier: ctx.supplier,
      model: "UAT-1",
      specification_section: "26 52 13",
      description: "UAT made-up luminaires for a UAT check.",
      items: [{ fixture_type: "UAT luminaire", description: "Ceiling mounted", quantity: 4, unit: "pcs" }],
      trade: ctx.trade,
      location: ctx.location,
      ...extra,
    },
  });
  if (res.status !== 201) throw new Error(`Create MAR answered ${res.status}: ${res.text.slice(0, 300)}`);
  const id = (res.body as { id: string }).id;
  await uploadFile(api, id, "datasheet", "UAT-datasheet.pdf", "application/pdf", tinyPdf());
  return id;
}

export const take = (api: Api, id: string, transition: string, extra: Record<string, unknown> = {}): Promise<ApiReply> => api.transition(id, transition, extra);

export async function mustTake(api: Api, id: string, transition: string, extra: Record<string, unknown> = {}): Promise<void> {
  const r = await take(api, id, transition, extra);
  if (r.status >= 300) throw new Error(`${api.person} ${transition} answered ${r.status}: ${r.text.slice(0, 300)}`);
}

export async function mustPickUp(api: Api, id: string): Promise<void> {
  const r = await api.post(`/work-items/${id}/pick-up`);
  if (r.status >= 300) throw new Error(`${api.person} pick-up answered ${r.status}: ${r.text.slice(0, 300)}`);
}

/** The Document Number of an item as `api` reads it. */
export async function numberOf(api: Api, id: string): Promise<string | null> {
  return ((await api.get(`/work-items/${id}`)).body as { documentNumber?: string | null } | null)?.documentNumber ?? null;
}

/** Hafiz sends it, Ali picks up and Submits to DCL. */
export async function toSubmitted(hafiz: Api, ali: Api, id: string, coverNote = "UAT cover note"): Promise<void> {
  await mustTake(hafiz, id, "send_for_review");
  await mustPickUp(ali, id);
  await mustTake(ali, id, "submit", { answers: { cover_note: coverNote } });
}

/** Ahmed picks up and Sends to Manager with a Recommended Code and an Internal Note; Mohammed picks up. */
export async function toManager(ahmed: Api, mohammed: Api, id: string, code = "A", note = "UAT internal note"): Promise<void> {
  await mustPickUp(ahmed, id);
  await mustTake(ahmed, id, "send_to_manager", {
    answers: { sample_checked: true, matches_specification: code === "A", ...(code === "A" ? {} : { verification_note: "UAT verification note" }) },
    recommendedCode: code,
    internalNote: note,
  });
  await mustPickUp(mohammed, id);
}

/** Mohammed issues a Code. `transition` approve_a, revise_c ...; C needs remarks. */
export async function issueCode(mohammed: Api, id: string, transition = "approve_a"): Promise<void> {
  const answers: Record<string, unknown> = { sample_checked: true, matches_specification: transition === "approve_a" };
  if (transition !== "approve_a") { answers.remarks = "UAT remarks"; answers.verification_note = "UAT verification note"; }
  await mustTake(mohammed, id, transition, { answers });
}

/** Waits (polls) for `check` to be truthy, up to `ms`. */
export async function until<T>(check: () => Promise<T | false | null | undefined>, ms = 60_000, every = 2_000): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await check();
    if (v) return v;
    await new Promise((r) => setTimeout(r, every));
  }
  return undefined;
}

// ---- PDFs ----

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./browser.ts";

/** The text of each page of a PDF (pdfjs-dist from apps/api), items joined with a space. */
export async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  const lib = (await import(pathToFileURL(resolve(root, "apps/api/node_modules/pdfjs-dist/legacy/build/pdf.mjs")).href)) as {
    getDocument: (o: { data: Uint8Array; useSystemFonts?: boolean }) => { promise: Promise<{ numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: { str?: string }[] }> }> }>; destroy(): Promise<void> };
  };
  const task = lib.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const pdf = await task.promise;
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    pages.push(content.items.map((i) => i.str ?? "").join(" ").replace(/\s+/g, " ").trim());
  }
  await task.destroy();
  return pages;
}

/** Fetches a signed link's file. */
export async function fetchBytes(url: string): Promise<{ status: number; type: string | null; bytes: Uint8Array }> {
  const res = await fetch(url);
  return { status: res.status, type: res.headers.get("content-type"), bytes: new Uint8Array(await res.arrayBuffer()) };
}

/** The sealed record of a closed item as `api` downloads it (the signed link, then the file). */
export async function recordPdf(api: Api, id: string): Promise<{ status: number; linkStatus: number; bytes: Uint8Array; url?: string }> {
  const link = await api.get(`/work-items/${id}/documental-record`);
  if (link.status !== 200) return { status: 0, linkStatus: link.status, bytes: new Uint8Array() };
  const url = (link.body as { url: string }).url;
  const f = await fetchBytes(url);
  return { status: f.status, linkStatus: 200, bytes: f.bytes, url };
}

/** The Working Copy of an unfinished item: asks until the worker has printed it. */
export async function workingCopyPdf(api: Api, id: string, ms = 90_000): Promise<{ status: string; bytes?: Uint8Array; url?: string }> {
  const end = Date.now() + ms;
  let status = "preparing";
  while (Date.now() < end) {
    const r = await api.post(`/work-items/${id}/working-copy`);
    const b = r.body as { status?: string; url?: string } | null;
    status = b?.status ?? `http ${r.status}`;
    if (status === "ready" && b?.url) {
      const f = await fetchBytes(b.url);
      return { status, bytes: f.bytes, url: b.url };
    }
    if (status !== "preparing") return { status };
    await new Promise((x) => setTimeout(x, 1500));
  }
  return { status };
}

// ---- Case helpers ----

import type { CaseApi } from "./case.ts";
import { mailpitUrl } from "./browser.ts";

/** `t.check` that also remembers whether every check so far held. */
export function tracker(t: CaseApi) {
  let all = true;
  return {
    check(text: string, ok: boolean, detail?: string): boolean {
      if (!ok) all = false;
      return t.check(text, ok, detail);
    },
    get ok() {
      return all;
    },
    /** A case a person must finish: when the checks a script can make all hold, say so; when one fails, leave the fail. */
    manualIfClean(reason: string) {
      if (all) t.manual(reason);
    },
  };
}

/** Signed-in api clients, made one after the other (the dev server is slow when many start at once). */
export async function apis<K extends string>(...names: K[]): Promise<Record<K, Api>> {
  const out = {} as Record<K, Api>;
  for (const n of names) out[n] = await Api.as(n);
  return out;
}

export type MailFull = { id: string; to: string[]; subject: string; text: string; html: string; created: string };

/** One message in full. */
export async function mailFull(id: string): Promise<MailFull> {
  const j = (await (await fetch(`${mailpitUrl}/api/v1/message/${id}`)).json()) as { ID: string; To: { Address: string }[]; Subject: string; Text: string; HTML: string; Date: string };
  return { id: j.ID, to: j.To.map((x) => x.Address), subject: j.Subject, text: j.Text, html: j.HTML, created: j.Date };
}

/** The mails to `address` whose subject holds `needle`, newest first (Mailpit search by recipient, then filtered). */
export async function mailsAbout(address: string, needle: string): Promise<MailFull[]> {
  const res = await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}&limit=200`);
  const json = (await res.json()) as { messages?: { ID: string; Subject: string }[] };
  const hit = (json.messages ?? []).filter((m) => m.Subject.includes(needle));
  return Promise.all(hit.map((m) => mailFull(m.ID)));
}

export const emailOf: Record<string, string> = {
  saeed: "saeed.alqahtani@tmc.demo.rabaed.test",
  hafiz: "hafiz.hamdan@tmc.demo.rabaed.test",
  ali: "ali.sonour@tmc.demo.rabaed.test",
  omar: "omar.alharbi@tmc.demo.rabaed.test",
  yousef: "yousef.karim@betabuild.demo.rabaed.test",
  ahmed: "ahmed.binsaid@designconsultants.demo.rabaed.test",
  sara: "sara@designconsultants.demo.rabaed.test",
  mohammed: "mohammed.alshamsi@designconsultants.demo.rabaed.test",
  faisal: "faisal.alotaibi@alwaha.demo.rabaed.test",
  noura: "noura.alharbi@alwaha.demo.rabaed.test",
  nasser: "nasser.aldosari@betabuild.demo.rabaed.test",
};

/** Names of people of another Company that must never appear in what a recipient reads of TMC's work. */
export const TMC_PEOPLE = ["Ali Sonour", "Hafiz Hamdan", "Saeed Al Qahtani", "Omar Al Harbi", "علي سنور", "حافظ حمدان"];
export const DCL_PEOPLE = ["Ahmed bin Said", "Mohammed Al Shamsi", "Sara ", "Layla Mansour", "محمد الشامسي", "أحمد بن سعيد"];

/** The notifications of `api`'s person about item `id`. */
export async function notificationsFor(api: Api, id: string): Promise<{ id: string; kind: string; step: unknown; event: unknown; readAt: string | null }[]> {
  const b = (await api.get("/notifications")).body as { notifications: { id: string; kind: string; workItemId: string; step: unknown; event: unknown; readAt: string | null }[] };
  return b.notifications.filter((n) => n.workItemId === id);
}

export const DOCNO = /TWR-[A-Z]{3}-\d{2}-\d{4}(?: Rev \d+)?/;
export const ARABIC_INDIC = /[\u0660-\u0669\u06F0-\u06F9]/;

import { deflateSync } from "node:zlib";

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

/** A valid PNG: a w x h image with a dark diagonal stroke on white (a made-up Signature to upload). */
export function tinyPng(w = 120, h = 40): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3, 255);
    row[0] = 0;
    const x0 = Math.floor((y / h) * (w - 10));
    for (let x = x0; x < x0 + 6; x++) {
      row[1 + x * 3] = 20;
      row[2 + x * 3] = 20;
      row[3 + x * 3] = 90;
    }
    rows.push(row);
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
