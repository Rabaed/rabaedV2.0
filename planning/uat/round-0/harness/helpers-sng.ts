import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { round } from "./browser.ts";
import { Api } from "./helpers.ts";
import * as H from "./helpers-sub.ts";
import { detail, exifJpeg, team, upload, type Json, type Team } from "./helpers-sub.ts";

export { detail, exifJpeg, team, upload };
export type { Json, Team };

// Helpers of the SNG, INS, IMP and PKG cases: Snags, WIRs, Packages and register files, driven
// through the api as the web app drives them.

/** Takes the Transition of `item` whose key matches `key` (string prefix or regex), picking the item up first when it waits in the person's pool. */
export async function act(api: Api, id: string, key: string | RegExp, extra: Json = {}): Promise<{ status: number; text: string; taken: string | null }> {
  let d = await detail(api, id);
  if (d.actions.pickUp) await api.post(`/work-items/${id}/pick-up`);
  d = await detail(api, id);
  const match = (k: string) => (typeof key === "string" ? k === key || k.startsWith(key) : key.test(k));
  const t = (d.actions.transitions as Json[]).find((x) => match(x.key));
  if (!t) return { status: 0, text: `no transition ${String(key)} offered; offered: ${(d.actions.transitions as Json[]).map((x) => x.key).join(", ") || "none"}`, taken: null };
  const r = await api.transition(id, t.key, extra);
  return { status: r.status, text: r.text, taken: t.key };
}

export async function mustAct(api: Api, id: string, key: string | RegExp, extra: Json = {}): Promise<string> {
  const r = await act(api, id, key, extra);
  if (r.status < 200 || r.status >= 300) throw new Error(`${api.person} ${String(key)} on ${id} answered ${r.status}: ${r.text.slice(0, 300)}`);
  return r.taken!;
}

export const keysOf = (d: Json): string[] => (d.actions.transitions as Json[]).map((t) => t.key);

/** A Snag (SNG) or other Snag List item, created as a Draft by `api`. */
export async function createSnagItem(api: Api, tm: Team, type: "SNG" | "OBS" | "QSC" | "QSN", title: string, over: Json = {}): Promise<string> {
  const answers = { description: "UAT made-up snag description.", trade: tm.d.trade("Electrical Works"), location: tm.d.loc("Tower 1 Floor 02"), ...over };
  const r = await api.post(`/projects/${tm.projectId}/work-items`, { type, title, answers });
  if (r.status !== 201) throw new Error(`create ${type} "${title}" answered ${r.status}: ${r.text.slice(0, 300)}`);
  return (r.body as Json).id as string;
}

export async function create(api: Api, tm: Team, type: string, title: string, answers: Json) {
  return api.post(`/projects/${tm.projectId}/work-items`, { type, title, answers });
}

/** The items of a module via api (all pages are not followed: the first page). */
export async function moduleItems(api: Api, projectId: string, module: "snag_list" | "submittals" | "inspections", query = ""): Promise<Json[]> {
  const r = await api.get(`/projects/${projectId}/modules/${module}/work-items${query ? `?${query}` : ""}`);
  return ((r.body as Json)?.items ?? []) as Json[];
}

export async function findByTitle(api: Api, projectId: string, module: "snag_list" | "submittals" | "inspections", title: string): Promise<Json | undefined> {
  const items = await moduleItems(api, projectId, module, `q=${encodeURIComponent(title)}&pageSize=50`);
  return items.find((i) => i.title === title);
}

/** A tiny PNG-free test photo: a real small JPEG with EXIF, as the demo seed makes. */
export const testPhoto = exifJpeg;

// ---- Register files (fixtures-data) ----

export const dataDir = resolve(round, "fixtures-data");

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** A minimal .xlsx (zip, stored) with the given sheets of text rows. Cells are inline strings, read as stored. */
export function makeXlsx(sheets: { name: string; rows: string[][] }[]): Buffer {
  const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const colName = (i: number) => String.fromCharCode(65 + i);
  const files: [string, string][] = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`],
    ...sheets.map((s, i): [string, string] => [
      `xl/worksheets/sheet${i + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${s.rows
        .map((row, r) => `<row r="${r + 1}">${row.map((v, c) => (v === "" ? "" : `<c r="${colName(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`)).join("")}</row>`)
        .join("")}</sheetData></worksheet>`,
    ]),
  ];
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameB = Buffer.from(name);
    const data = Buffer.from(text);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameB.length, 26);
    parts.push(local, nameB, data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameB.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameB);
    offset += 30 + nameB.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, end]);
}

export function makeCsv(rows: string[][]): Buffer {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
  return Buffer.from(rows.map((r) => r.map(q).join(",")).join("\n") + "\n", "utf8");
}

/** Writes a register under fixtures-data (so the browser can upload it) and returns its path. */
export function writeData(name: string, bytes: Buffer): string {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const file = resolve(dataDir, name);
  writeFileSync(file, bytes);
  return file;
}

export const b64 = (bytes: Buffer) => bytes.toString("base64");

/** A register request body for the import api. */
export const regFile = (fileName: string, bytes: Buffer) => ({ fileName, content: b64(bytes) });

/** Run id to keep register rows apart between runs. */
export const runTag = () => new Date().toISOString().slice(11, 19).replaceAll(":", "");

// ---- Packages ----

export const bilingual = (en: string) => ({ en, ar: `${en} (ع)` });

/** A new Package of `api`'s Participant; returns its id and PKG number. */
export async function makePackage(api: Api, tm: Team, name: string): Promise<{ id: string; number: string }> {
  const r = await api.post(`/projects/${tm.projectId}/packages`, { name: bilingual(name) });
  if (r.status !== 201) throw new Error(`create Package "${name}" answered ${r.status}: ${r.text.slice(0, 200)}`);
  return r.body as { id: string; number: string };
}

export async function addToPackage(api: Api, packageId: string, workItemId: string): Promise<number> {
  return (await api.post(`/packages/${packageId}/items`, { workItemId })).status;
}

export async function submitPackage(api: Api, packageId: string): Promise<{ status: number; text: string; body: unknown }> {
  const r = await api.post(`/packages/${packageId}/submit`, { confirmed: true, idempotencyKey: crypto.randomUUID() });
  return { status: r.status, text: r.text, body: r.body };
}

/** The MAR Form's answers for a MAR of the given Trade (Electrical Works or Mechanical Works). */
export async function marAnswersFor(tm: Team, trade: "Electrical Works" | "Mechanical Works", over: Json = {}): Promise<Json> {
  const base = await H.marAnswers(tm);
  const supplier = trade === "Electrical Works" ? base.supplier : undefined;
  return { ...base, ...(supplier ? {} : {}), trade: tm.d.trade(trade), ...over };
}
