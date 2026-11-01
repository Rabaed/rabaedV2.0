// Seam 1 for the List row menu's Download (RP-1175, UAT SUB-18; visibility.md, the Working Copy row,
// V1, V14, V19; scenario RP-1175-1). The row menu's Download opens the item's Working Copy, the same
// call as the item page's "Download PDF" (apps/web/src/lib/item-pdf.ts): it is offered on a Draft for
// the Members who see it, and on another Company's Submitted item for the viewer who reads it, giving
// exactly the item as shared (GET /shared): its answers as they last arrived, its shared moves by
// Company only. Never a Step, a person, an Internal Note, an answer that has not arrived, or a move
// inside another Participant, for the viewer's own Company too. Whoever doesn't see the item gets the
// plain 404, the same as for /shared.
//
// Seam 2 is packages/db/test/working-copy-rls.test.ts (what the worker reads to print), which this
// file reads through the api and the PDF itself.
import { createDb, type OutboxHandler } from "@rabaed/db";
import { drainOutbox, expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import type { SharedWorkItem, WorkingCopyAnswer } from "@rabaed/domain";
import { chromiumRenderer, fallbackFonts, projectFilesFromEnv, s3RecordFiles, workingCopyHandler } from "@rabaed/worker/record";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, detail, memberOnProject, ok, take, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const urls = testDatabaseUrls();
// The worker connects as the app role, with no Member set.
const worker = createDb(urls.app, { max: 2 });
const migrator = createDb(urls.migrator, { max: 1 });
const renderer = chromiumRenderer();
afterAll(async () => {
  await renderer.close();
  await api.close();
  await Promise.all([worker.destroy(), migrator.destroy()]);
});

const TYPE = "RMDL";
const schema = {
  sections: [
    {
      key: "material",
      title: bilingual("Material"),
      fields: [
        { key: "model", type: "text", label: bilingual("Model") },
        { key: "finish", type: "text", label: bilingual("Finish") },
      ],
    },
    {
      key: "classification",
      title: bilingual("Classification"),
      fields: [
        { key: "trade", type: "trade", label: bilingual("Trade") },
        { key: "location", type: "location", label: bilingual("Location") },
        { key: "scopes", type: "scopes", label: bilingual("Scopes") },
      ],
    },
  ],
};

const PEOPLE = { engineer: "Rima Alamoudi", pm: "Yousef Nashar", k1Engineer: "Dalal Qurashi", k1Pm: "Majed Tuwaijri" };
const NOTE_C1 = "C1 only: negotiated price";
const NOTE_K1 = "K1 only: their supplier is weak";
const UNARRIVED = "Matt black, changed after it was Sent Back";

let c1: Company;
let c1Name = "";
let k1Name = "";
let engineer: Caller;
let pm: Caller;
let k1Engineer: Caller;
let k1Pm: Caller;
let c2Engineer: Caller;
let projectId = "";
let electrical = "";
let buildingA = "";
/** Submitted, picked up by K1 and not moved: C1 and K1 both hold internal moves in its history. */
let open = "";
/** Submitted, Sent Back by K1 to C1's Draft, changed there: nothing of the change has arrived. */
let held = "";
let draftId = "";

const names = new Map<Caller, string>();
const nameOf = (by: Caller) => names.get(by) ?? "someone";

const handler: OutboxHandler = workingCopyHandler({ files: s3RecordFiles(projectFilesFromEnv()), renderer, fonts: async () => fallbackFonts() });
const runWorker = () => drainOutbox(worker, { working_copy: handler });

const shared = async (by: Caller, id: string): Promise<SharedWorkItem> => (await ok(by.get(`/v1/work-items/${id}/shared`), 200)).json();
const squeeze = (s: string) => s.replace(/\s+/g, "");

/** What the row menu's Download does for `by`: asks for the Working Copy (as apps/web/src/lib/item-pdf.ts does) until it is ready, then opens the file. */
async function rowMenuDownload(by: Caller, id: string): Promise<string> {
  const ask = async () => (await ok(by.post(`/v1/work-items/${id}/working-copy`), 200)).json() as WorkingCopyAnswer;
  let answer = await ask();
  if (answer.status === "preparing") {
    await runWorker();
    answer = await ask();
  }
  if (answer.status !== "ready") throw new Error(`not ready: ${answer.status}`);
  const res = await fetch(answer.url);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("application/pdf");
  return printed(new Uint8Array(await res.arrayBuffer()));
}

/** Everything the PDF prints, as one string without whitespace. */
async function printed(bytes: Uint8Array): Promise<string> {
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const pdf = await task.promise;
  let text = "";
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    text += content.items.map((item) => ("str" in item ? item.str : "")).join("");
  }
  await task.destroy();
  return squeeze(text);
}

type HistoryEvent = {
  audience: "shared" | "internal";
  transition: { en: string } | null;
  fromStep: { en: string } | null;
  toStep: { en: string } | null;
  internalNote: string | null;
  by: { memberName: { en: string } | null };
};
/** The words of `by`'s own internal moves of item `id`: a Step, a Transition, an Internal Note, a person. */
async function internalWords(by: Caller, id: string): Promise<string[]> {
  const { events } = (await ok(by.get(`/v1/work-items/${id}/history`), 200)).json() as { events: HistoryEvent[] };
  return events
    .filter((e) => e.audience === "internal")
    .flatMap((e) => [e.fromStep?.en, e.toStep?.en, e.transition?.en, e.internalNote, e.by.memberName?.en])
    .filter((w): w is string => !!w && squeeze(w).length >= 8);
}

/** A thing the Download must not hold, named by an id of this test's own: `text` is what it would print. */
type Hidden = { id: string; text: string };
const hiddenThing = (kind: string, text: string): Hidden => ({ id: `${kind}:${text}`, text });

/**
 * A way of reading item `id` for expectHiddenFrom: `reads(h)` is whether `h` is in what is read. Someone's own
 * pages (their history and the item) show them their own words, so each hidden thing really exists and the
 * read works; a Download is the file the row menu opens for them.
 */
type Viewer = { name: string; reads: (h: Hidden) => Promise<boolean> };
const copies = new Map<string, Promise<string>>();
const ownPages = (name: string, by: Caller, id: string): Viewer => ({
  name: `${name} in their own pages`,
  reads: async (h) => {
    const pages = squeeze(JSON.stringify([(await ok(by.get(`/v1/work-items/${id}/history`), 200)).json(), await detail(by, id)]));
    return pages.includes(squeeze(h.text));
  },
});
const downloadOf = (by: Caller, id: string): Viewer => ({
  name: `${nameOf(by)}'s Download`,
  reads: async (h) => {
    const key = `${nameOf(by)}:${id}`;
    if (!copies.has(key)) copies.set(key, rowMenuDownload(by, id));
    return (await copies.get(key)!).includes(squeeze(h.text));
  },
});

beforeAll(async () => {
  await addSendBackType(migrator, TYPE, { en: "Row menu Download submittal", ar: "تنزيل من قائمة الصف" }, schema);
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  const post = async (path: string, body: unknown) => (await c1.caller.post(`/v1/projects/${projectId}/${path}`, body)).json().id as string;
  electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
  const participants = (await c1.caller.get(`/v1/projects/${projectId}/participants`)).json().participants as { id: string; isOwnCompany: boolean; company: { legalName: { en: string } } }[]; // not hidden-from: reads the Project's own Company name, to look for it in the printed text
  const own = participants.find((p) => p.isOwnCompany)!;
  c1Name = own.company.legalName.en; // not hidden-from: reads the Project's own Company name, to look for it in the printed text
  await ok(c1.caller.request("PUT", `/v1/participants/${own.id}/visibility`, { trade: all, location: all }));
  engineer = (await memberOnProject(api, c1, own.id, ["engineer"], { name: PEOPLE.engineer })).caller;
  pm = (await memberOnProject(api, c1, own.id, ["project_manager"], { name: PEOPLE.pm })).caller;

  const other = async (role: "consultant" | "contractor") => {
    const company = await api.authorizedPerson();
    const participantId = await api.addParticipant(c1.caller, projectId, company.company, role);
    await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
    return { company, participantId };
  };
  const k1 = await other("consultant");
  k1Name = (await detailOfParticipant(k1.participantId)) ?? "";
  k1Engineer = (await memberOnProject(api, k1.company, k1.participantId, ["engineer"], { name: PEOPLE.k1Engineer })).caller;
  k1Pm = (await memberOnProject(api, k1.company, k1.participantId, ["engineer"], { name: PEOPLE.k1Pm })).caller;
  const c2 = await other("contractor");
  c2Engineer = await memberOnProject(api, c2.company, c2.participantId, ["engineer"]).then((m) => m.caller);
  for (const [by, name] of [
    [engineer, "the C1 engineer"],
    [pm, "the C1 PM"],
    [k1Engineer, "the K1 engineer"],
    [k1Pm, "K1's second engineer"],
    [c2Engineer, "the C2 engineer"],
  ] as const)
    names.set(by, name);

  const draftOf = async (model: string) =>
    (
      await ok(
        engineer.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title: model, answers: { model, finish: "Satin steel", trade: electrical, location: buildingA } }),
        201,
      )
    ).json().id as string;
  const submit = async (id: string) => {
    await take(engineer, id, "send_for_review", { internalNote: NOTE_C1 });
    await ok(pm.post(`/v1/work-items/${id}/pick-up`));
    await take(pm, id, "submit", { internalNote: NOTE_C1 });
  };

  open = await draftOf("Busbar trunking 1175");
  await submit(open);
  await ok(k1Engineer.post(`/v1/work-items/${open}/pick-up`));

  held = await draftOf("Cable ladders 1175");
  await submit(held);
  await ok(k1Engineer.post(`/v1/work-items/${held}/pick-up`));
  await take(k1Engineer, held, "send_back_to_draft", { internalNote: NOTE_K1 });
  await ok(engineer.request("PUT", `/v1/work-items/${held}/answers`, { answers: { ...(await detail(engineer, held)).answers, finish: UNARRIVED } }));

  draftId = await draftOf("Draft 1175");
}, 240_000);

/** The name of the participant's Company, as the Project lists it. */
async function detailOfParticipant(participantId: string): Promise<string | undefined> {
  const list = (await c1.caller.get(`/v1/projects/${projectId}/participants`)).json().participants as { id: string; company: { legalName: { en: string } } }[]; // not hidden-from: reads a Company name, to look for it in the printed text
  return list.find((p) => p.id === participantId)?.company.legalName.en; // not hidden-from: reads a Company name, to look for it in the printed text
}

describe("scenario RP-1175-1: the row menu's Download of another Company's Submitted item is exactly what /shared holds", () => {
  it("prints the shared answers and the shared moves by Company only, the same file for the other Company and for the raiser's own", async () => {
    for (const id of [open, held]) {
      const item = await shared(k1Pm, id);
      const copies = await Promise.all([k1Pm, k1Engineer, pm, engineer].map((by) => rowMenuDownload(by, id)));
      for (const copy of copies) expect(copy).toBe(copies[0]);
      const text = copies[0]!;
      expect(text, "the Subject").toContain(squeeze(item.title));
      expect(text, "the Document Number").toContain(squeeze(item.documentNumber!));
      for (const [key, value] of Object.entries(item.answers)) if (typeof value === "string" && !/^[0-9a-f-]{36}$/.test(value)) expect(text, `the answer ${key}`).toContain(squeeze(value));
      // The shared moves, by the Companies' names.
      expect(text, "the raiser").toContain(squeeze(c1Name));
      expect(text, "the other Company").toContain(squeeze(k1Name));
      expect(item.history.some((e) => e.companyName !== null)).toBe(true);
    }
  }, 240_000);

  it("holds no Step, no person, no Internal Note, no answer that has not arrived and no move inside another Participant, by id, for the other Company and the raiser's own", async () => {
    for (const id of [open, held]) {
      const c1Words = await internalWords(pm, id);
      const k1Words = await internalWords(k1Engineer, id);
      // A word /shared holds too (a shared label, say) is not hidden by this Download.
      const sharedText = squeeze(JSON.stringify(await shared(k1Pm, id)));
      const hidden = [
        ...c1Words.map((w) => hiddenThing("c1-internal", w)),
        ...k1Words.map((w) => hiddenThing("k1-internal", w)),
        // The people who act on the item: K1's second engineer never does, so no page shows them.
        ...[PEOPLE.engineer, PEOPLE.pm, PEOPLE.k1Engineer].map((w) => hiddenThing("person", w)),
        // K1's note is on the Send Back only.
        ...(id === held ? [NOTE_C1, NOTE_K1] : [NOTE_C1]).map((w) => hiddenThing("internal-note", w)),
        ...(id === held ? [hiddenThing("unarrived-answer", UNARRIVED)] : []),
      ].filter((h) => !sharedText.includes(squeeze(h.text)));
      for (const kind of ["c1-internal", "k1-internal", "person", "internal-note"]) expect(hidden.some((h) => h.id.startsWith(kind)), `${kind} words of the ${id === open ? "open" : "held"} item`).toBe(true);
      const downloads = [k1Pm, k1Engineer, pm, engineer].map((by) => downloadOf(by, id));
      for (const thing of hidden) {
        // Whoever writes it reads it in their own pages first; their Download, and the other Company's, never print it.
        let owner: Caller | undefined;
        for (const by of [engineer, pm, k1Engineer]) {
          if (await ownPages(nameOf(by), by, id).reads(thing)) {
            owner = by;
            break;
          }
        }
        expect(owner, `${thing.id} is read by someone in their own pages`).toBeDefined();
        await expectHiddenFrom<Viewer, Hidden>({
          read: async (viewer) => ((await viewer.reads(thing)) ? [thing] : []),
          target: thing.id,
          seenBy: ownPages(nameOf(owner!), owner!, id),
          hiddenFrom: downloads,
          name: (viewer) => viewer.name,
          label: `${thing.id} in the ${id === open ? "open" : "held"} item`,
        });
      }
    }
  }, 300_000);

  it("is the plain 404 for another Contractor, who doesn't see the item: the Download and /shared alike", async () => {
    for (const id of [open, held]) {
      const read = async (by: Caller) => {
        const res = await by.post(`/v1/work-items/${id}/working-copy`);
        if (res.statusCode === 200) return [{ id }];
        await expectHidden(res, `the working copy of ${id}`); // not hidden-from: the read of expectHiddenFrom above it: its seenBy viewers read the copy first
        return [];
      };
      await expectHiddenFrom({ read, target: id, seenBy: [pm, k1Pm], hiddenFrom: c2Engineer, name: nameOf, label: "the Download" });
      await expectHidden(c2Engineer.get(`/v1/work-items/${id}/shared`)); // not hidden-from: the same plain 404 as the Download above; the first test reads /shared as the other Company, the positive control
    }
  });
});

describe("scenario RP-1175-1: a Draft's Download is its Working Copy, for the Members who see the Draft", () => {
  it("is printed for the raiser, and is the plain 404 for the other Company and another Contractor", async () => {
    const read = async (by: Caller) => {
      const res = await by.post(`/v1/work-items/${draftId}/working-copy`);
      if (res.statusCode === 200) return [{ id: draftId }];
      await expectHidden(res, "the Draft's working copy"); // not hidden-from: the read of expectHiddenFrom above it: its seenBy viewers read the Draft first
      return [];
    };
    await expectHiddenFrom({ read, target: draftId, seenBy: [engineer, pm], hiddenFrom: [k1Pm, c2Engineer], name: nameOf, label: "the Draft's Download" });
    const text = await rowMenuDownload(engineer, draftId);
    expect(text).toContain(squeeze("Draft 1175"));
    for (const person of Object.values(PEOPLE)) expect(text, person).not.toContain(squeeze(person)); // not hidden-from: the raiser's own Draft file, printed for the raiser in the line above, and shown to hold the Subject
    // /shared has nothing of a Draft, for anyone.
    await expectHidden(engineer.get(`/v1/work-items/${draftId}/shared`)); // not hidden-from: a Draft has nothing shared; the Submitted items' /shared is read in the first test
  }, 120_000);
});
