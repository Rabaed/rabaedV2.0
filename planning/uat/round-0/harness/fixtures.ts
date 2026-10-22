import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { round } from "./browser.ts";
import { Api, projectIdOf } from "./helpers.ts";

// node planning/uat/round-0/harness/run.ts --fixtures [--only FX-C2,FX-OR]
//
// Strategy 2.5. Each fixture checks the state first and applies only what is missing, through the
// api as the seeded people (the same calls the Settings pages make). What was done goes to
// results/fixtures.json.

export type FixtureRecord = { status: "applied" | "already" | "manual" | "failed"; detail: string; at: string };
const file = resolve(round, "results", "fixtures.json");

type Dim = { id: string; parentId: string | null; depth: number; code: string; name: { en: string; ar: string } };
type Grant = { isAll: boolean; valueIds: string[] };
type Vis = { trade: Grant; location: Grant };

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const same = (g: Grant, isAll: boolean, ids: string[]) => g.isAll === isAll && sameSet(g.valueIds, ids);

function must<T>(reply: { status: number; body: unknown; text: string }, what: string): T {
  if (reply.status >= 400) throw new Error(`${what} answered ${reply.status}: ${reply.text.slice(0, 300)}`);
  return reply.body as T;
}

/** Everything a visibility fixture needs: the Project, its Trades and Locations by code. */
async function project(api: Api) {
  const projectId = await projectIdOf(api);
  if (!projectId) throw new Error(`${api.person} does not see the Project.`);
  const dims = must<{ trade: Dim[]; location: Dim[] }>(await api.get(`/projects/${projectId}/dimensions`), "dimensions");
  const loc = (name: string) => {
    const d = dims.location.find((l) => l.name.en === name);
    if (!d) throw new Error(`No Location "${name}" (have ${dims.location.map((l) => l.name.en).join(", ")}).`);
    return d.id;
  };
  const trade = (name: string) => {
    const d = dims.trade.find((l) => l.name.en.startsWith(name));
    if (!d) throw new Error(`No Trade "${name}" (have ${dims.trade.map((l) => l.name.en).join(", ")}).`);
    return d.id;
  };
  return { projectId, loc, trade };
}

async function participantOf(saeed: Api, projectId: string, company: string): Promise<string> {
  const body = must<{ participants: { id: string; company: { legalName: { en: string } } }[] }>(await saeed.get(`/projects/${projectId}/participants`), "participants");
  const p = body.participants.find((x) => x.company.legalName.en.includes(company));
  if (!p) throw new Error(`No Participant "${company}" on the Project.`);
  return p.id;
}

/** FX-C2: Beta Build narrowed to Tower 2 (PAR-14). */
async function fxC2(): Promise<FixtureRecord> {
  const saeed = await Api.as("saeed");
  const { projectId, loc } = await project(saeed);
  const participantId = await participantOf(saeed, projectId, "Beta Build");
  const now = must<{ visibility: Vis }>(await saeed.get(`/participants/${participantId}/visibility`), "Beta Build visibility").visibility;
  const tower2 = loc("Tower 2");
  if (same(now.location, false, [tower2])) return { status: "already", detail: "Beta Build already covers Tower 2 only.", at: new Date().toISOString() };
  const reply = await saeed.put(`/participants/${participantId}/visibility`, { trade: now.trade, location: { isAll: false, valueIds: [tower2] } });
  must(reply, "set Beta Build visibility");
  return { status: "applied", detail: "Saeed set Beta Build's Location to Tower 2 only (Trade unchanged).", at: new Date().toISOString() };
}

/** Sets a Member's Visibility as their Company's Authorized Person; changes only the given dimension. */
async function narrowMember(authorized: Api, projectId: string, company: string, email: string, change: (v: Vis) => Vis | null): Promise<string> {
  const mine = must<{ participants: { id: string; project: { id: string } }[] }>(await authorized.get("/participants"), "participations");
  const participantId = mine.participants.find((p) => p.project.id === projectId)?.id;
  if (!participantId) throw new Error(`${authorized.person} has no Participant on the Project.`);
  const members = must<{ members: { id: string; email: string }[] }>(await authorized.get(`/participants/${participantId}/members`), `${company} members`);
  const member = members.members.find((m) => m.email.toLowerCase() === email);
  if (!member) throw new Error(`${email} is not a Project Member of ${company}.`);
  const now = must<{ visibility: Vis }>(await authorized.get(`/participants/${participantId}/members/${member.id}/visibility`), `${email} visibility`).visibility;
  const next = change(now);
  if (!next) return "already";
  must(await authorized.put(`/participants/${participantId}/members/${member.id}/visibility`, next), `set ${email} visibility`);
  return "applied";
}

/** FX-K1M: Layla narrows Sara to Mechanical only (PAR-15). */
async function fxK1M(): Promise<FixtureRecord> {
  const layla = await Api.as("layla");
  const { projectId, trade } = await project(await Api.as("saeed"));
  const mech = trade("Mechanical");
  const result = await narrowMember(layla, projectId, "Design Consultants LLC", "sara@designconsultants.demo.rabaed.test", (v) =>
    same(v.trade, false, [mech]) ? null : { trade: { isAll: false, valueIds: [mech] }, location: v.location },
  );
  return { status: result === "already" ? "already" : "applied", detail: result === "already" ? "Sara already covers Mechanical only." : "Layla set Sara's Trade to Mechanical only (Locations unchanged).", at: new Date().toISOString() };
}

/** FX-OR: Hind narrows Faisal to Tower 1 and Noura to Tower 2 (VIS-13). */
async function fxOR(): Promise<FixtureRecord> {
  const hind = await Api.as("hind");
  const { projectId, loc } = await project(await Api.as("saeed"));
  const done: string[] = [];
  for (const [email, place] of [
    ["faisal.alotaibi@alwaha.demo.rabaed.test", "Tower 1"],
    ["noura.alharbi@alwaha.demo.rabaed.test", "Tower 2"],
  ] as const) {
    const id = loc(place);
    const result = await narrowMember(hind, projectId, "Al Waha PMC", email, (v) =>
      same(v.location, false, [id]) ? null : { trade: v.trade, location: { isAll: false, valueIds: [id] } },
    );
    done.push(`${email.split("@")[0]} ${place}: ${result}`);
  }
  const applied = done.some((d) => d.endsWith("applied"));
  return { status: applied ? "applied" : "already", detail: `Hind narrowed Locations. ${done.join("; ")}.`, at: new Date().toISOString() };
}

/** FX-OW: UAT Owner Co is onboarded in Rabaed Admin, which asks the Engineer's password plus a code. */
async function fxOW(): Promise<FixtureRecord> {
  return {
    status: "manual",
    detail:
      "Needs Rabaed Admin sign-in as the Rabaed Engineer (password plus an emailed code). No script signs an Engineer in without handling the password, so ADM-02 (onboard UAT Owner Co, CR 9999000005) is done by a person, then Saeed invites it as Owner (PAR-16). Cases needing the Owner stay blocked until then.",
    at: new Date().toISOString(),
  };
}

/** FX-SB: a Project copy of the MAR Workflow with a Send Back (WF-09). */
async function fxSB(): Promise<FixtureRecord> {
  const { applySendBackWorkflows } = await import("./fixtures-sb.ts");
  return applySendBackWorkflows();
}

const fixtures: Record<string, () => Promise<FixtureRecord>> = { "FX-C2": fxC2, "FX-K1M": fxK1M, "FX-OR": fxOR, "FX-OW": fxOW, "FX-SB": fxSB };

export async function applyFixtures(only?: string[]): Promise<void> {
  mkdirSync(resolve(round, "results"), { recursive: true });
  const record: Record<string, FixtureRecord> = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, FixtureRecord>) : {};
  for (const [name, apply] of Object.entries(fixtures)) {
    if (only && !only.includes(name)) continue;
    try {
      record[name] = await apply();
    } catch (error) {
      record[name] = { status: "failed", detail: error instanceof Error ? error.message : String(error), at: new Date().toISOString() };
    }
    console.log(`${name.padEnd(7)} ${record[name]!.status.toUpperCase().padEnd(8)} ${record[name]!.detail}`);
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  }
}
