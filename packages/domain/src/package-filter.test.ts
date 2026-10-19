import { describe, expect, it } from "vitest";
import type { PackageSummary } from "./package.ts";
import { filterPackages, packageFilterChoices, packagesFilterFromSearchParams, packagesFilterSearchParams } from "./package-filter.ts";

const b = (en: string, ar: string) => ({ en, ar });
const electrical = { id: "0192e0a0-0000-7000-8000-000000000201", code: "EL", sort: 2, name: b("Electrical", "كهرباء") };
const mechanical = { id: "0192e0a0-0000-7000-8000-000000000202", code: "ME", sort: 1, name: b("Mechanical", "ميكانيكا") };
const c1 = "0192e0a0-0000-7000-8000-0000000000c1";
const c2 = "0192e0a0-0000-7000-8000-0000000000c2";

const pkg = (id: string, number: string, name: { en: string; ar: string }, owner: string, trades: (typeof electrical)[]): PackageSummary => ({
  id: `0192e0a0-0000-7000-8000-00000000000${id}`,
  projectId: "0192e0a0-0000-7000-8000-000000000100",
  number,
  name,
  status: "in_progress",
  owner: { participantId: owner, companyName: owner === c1 ? b("Al Bina Contracting", "البناء للمقاولات") : b("Riyadh Works", "أعمال الرياض") },
  trades,
  counts: { total: 1, open: 1, codes: {} },
});

const bathrooms = pkg("1", "PKG-004", b("Bathrooms – Tower 1", "دورات المياه – البرج 1"), c1, [mechanical]);
const plantRoom = pkg("2", "PKG-001", b("Plant room", "غرفة المعدات"), c1, [electrical, mechanical]);
const lighting = pkg("3", "PKG-001", b("Lighting", "الإنارة"), c2, [electrical]);
const empty = pkg("4", "PKG-002", b("New package", "حزمة جديدة"), c2, []);
const packages = [bathrooms, plantRoom, lighting, empty];
const none = { trade: [], company: [] };

describe("searching the Packages view (RP-953)", () => {
  it("finds a Package by its PKG number, whatever the case, or a part of it", () => {
    expect(filterPackages(packages, { ...none, q: "PKG-004" })).toEqual([bathrooms]);
    expect(filterPackages(packages, { ...none, q: "pkg-001" })).toEqual([plantRoom, lighting]);
    expect(filterPackages(packages, { ...none, q: "004" })).toEqual([bathrooms]);
  });

  it("finds a Package by its name in English or Arabic, in either language's page", () => {
    expect(filterPackages(packages, { ...none, q: "tower" })).toEqual([bathrooms]);
    expect(filterPackages(packages, { ...none, q: "غرفة" })).toEqual([plantRoom]);
    expect(filterPackages(packages, { ...none, q: "zzz" })).toEqual([]);
  });

  it("keeps every Package when nothing is searched or filtered", () => {
    expect(filterPackages(packages, none)).toEqual(packages);
    expect(filterPackages(packages, { ...none, q: "  " })).toEqual(packages);
  });
});

describe("filtering the Packages view by Trade and owning Company (RP-953)", () => {
  it("by Trade: the Packages with a submittal of any chosen Trade the viewer sees; one without any is left out", () => {
    expect(filterPackages(packages, { ...none, trade: [electrical.id] })).toEqual([plantRoom, lighting]);
    expect(filterPackages(packages, { ...none, trade: [electrical.id, mechanical.id] })).toEqual([bathrooms, plantRoom, lighting]);
  });

  it("by owning Company, any chosen; with the Trade and the search, all of them", () => {
    expect(filterPackages(packages, { ...none, company: [c2] })).toEqual([lighting, empty]);
    expect(filterPackages(packages, { q: "pkg-001", trade: [mechanical.id], company: [c1] })).toEqual([plantRoom]);
  });

  it("offers only the Trades and owning Companies of the Packages listed, each once, Trades in the Project's order (Mechanical first here), Companies by name", () => {
    expect(packageFilterChoices(packages, "en")).toEqual({
      trades: [mechanical, electrical],
      companies: [
        { participantId: c1, companyName: bathrooms.owner.companyName },
        { participantId: c2, companyName: lighting.owner.companyName },
      ],
    });
    // Only what the viewer sees: a narrowed viewer's list gives no other Trade, no other Company.
    expect(packageFilterChoices([lighting], "ar")).toEqual({ trades: [electrical], companies: [{ participantId: c2, companyName: lighting.owner.companyName }] });
    expect(packageFilterChoices([], "en")).toEqual({ trades: [], companies: [] });
  });
});

describe("the Packages view's filter in its URL (RP-953)", () => {
  it("reads the search, Trades and Companies, and leaves out a value that isn't an id", () => {
    expect(packagesFilterFromSearchParams({ view: "packages", q: " tower ", trade: `${electrical.id},nope`, company: c1 })).toEqual({
      q: "tower",
      trade: [electrical.id],
      company: [c1],
    });
    expect(packagesFilterFromSearchParams(new URLSearchParams("view=packages"))).toEqual({ trade: [], company: [] });
    expect(packagesFilterFromSearchParams({ q: "   " })).toEqual({ trade: [], company: [] });
  });

  it("writes them back, keeping the View, so a link opens the same board", () => {
    const params = packagesFilterSearchParams({ q: "tower", trade: [electrical.id, mechanical.id], company: [c2] });
    expect(params.toString()).toBe(new URLSearchParams({ view: "packages", q: "tower", trade: `${electrical.id},${mechanical.id}`, company: c2 }).toString());
    expect(packagesFilterFromSearchParams(params)).toEqual({ q: "tower", trade: [electrical.id, mechanical.id], company: [c2] });
    expect(packagesFilterSearchParams(none).toString()).toBe("view=packages");
  });
});
