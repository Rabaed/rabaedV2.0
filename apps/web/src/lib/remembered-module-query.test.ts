import { describe, expect, it } from "vitest";
import {
  moduleTabOf,
  queryToRemember,
  readRemembered,
  rememberedHref,
  rememberedPart,
  seenAt,
  writeRemembered,
  type RememberStorage,
} from "./remembered-module-query.ts";

/** The browser's storage, as a Map. */
function memoryStorage(): RememberStorage & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
}

/** Storage that throws on every call: a private window, or blocked site data. */
const throwingStorage: RememberStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

const member = "11111111-1111-4111-8111-111111111111";
const otherMember = "22222222-2222-4222-8222-222222222222";
const project = "33333333-3333-4333-8333-333333333333";
const otherProject = "44444444-4444-4444-8444-444444444444";
const submittals = { projectId: project, module: "submittals" } as const;

describe("a Module tab's address (RP-1240)", () => {
  it("names the Project and the Module, with or without the locale", () => {
    expect(moduleTabOf(`/en/projects/${project}/work-items`)).toEqual(submittals);
    expect(moduleTabOf(`/ar/projects/${project}/snag-list`)).toEqual({ projectId: project, module: "snag_list" });
    expect(moduleTabOf(`/projects/${project}/inspections?stage=draft`)).toEqual({ projectId: project, module: "inspections" });
  });

  it("is no other page's: the Dashboard, Settings, Activity, the New page or an item", () => {
    for (const path of [`/fr/projects/${project}/work-items`, `/en/projects/${project}`,`/en/projects/${project}/settings`, `/en/projects/${project}/activity`, `/en/projects/${project}/work-items/new`, `/en/work-items/${project}`, "/en"]) {
      expect(moduleTabOf(path)).toBeNull();
    }
  });
});

describe("what of the URL is remembered (RP-1240)", () => {
  it("keeps the filters, the sort and the Kanban view", () => {
    expect(rememberedPart("stage=draft&sort=owner&dir=desc", "submittals")).toBe("stage=draft&sort=owner&dir=desc");
    expect(rememberedPart("view=kanban&stage=draft", "submittals")).toBe("stage=draft&view=kanban");
  });

  it("never the page number, the open panel or any other one-off parameter", () => {
    expect(rememberedPart(`stage=draft&page=3&open=${project}&new=1&size=wide&draft=${project}&newModule=inspections`, "submittals")).toBe("stage=draft");
    expect(rememberedPart("view=kanban&page=2&cursor=abc", "submittals")).toBe("view=kanban");
  });

  it("is nothing for the List as it opens", () => {
    expect(rememberedPart("", "submittals")).toBe("");
    expect(rememberedPart("page=2", "inspections")).toBe("");
  });

  it("leaves out a filter that isn't valid, as the page does", () => {
    expect(rememberedPart("stepAgeMin=banana&stage=draft", "submittals")).toBe("stage=draft");
  });

  it("is not kept for the Submittals' Packages view, which takes no filter", () => {
    expect(rememberedPart("view=packages", "submittals")).toBeNull();
  });
});

describe("when the page writes what it remembers (RP-1240)", () => {
  const at = (query: string, path = `/en/projects/${project}/work-items`) => seenAt(path, query);

  it("keeps a filter the Member changes on the tab", () => {
    expect(queryToRemember(at(""), at("stage=draft"))).toBe("stage=draft");
    expect(queryToRemember(at("stage=draft"), at("stage=draft&sort=owner"))).toBe("stage=draft&sort=owner");
  });

  it("clears it when the Member clears the filters by hand", () => {
    expect(queryToRemember(at("stage=draft"), at(""))).toBe("");
  });

  it("writes nothing when a link brings its own query: from Home, a notification or an import chip", () => {
    expect(queryToRemember(seenAt("/en", ""), at("needMyAction=true"))).toBeNull();
    expect(queryToRemember(at("", `/en/projects/${project}/work-items/imports`), at(`importId=${project}`))).toBeNull();
    expect(queryToRemember(at("stage=draft", `/en/projects/${project}/inspections`), at("stage=closed"))).toBeNull();
  });

  it("writes nothing on the first page the browser opens (a reload, a bookmark)", () => {
    expect(queryToRemember(null, at("stage=draft"))).toBeNull();
  });

  it("writes nothing when only the panel opens or the language changes", () => {
    expect(queryToRemember(at("stage=draft"), at(`stage=draft&open=${project}`))).toBeNull();
    expect(queryToRemember(at("stage=draft"), at("stage=draft", `/ar/projects/${project}/work-items`))).toBeNull();
  });

  it("writes nothing to or from the Packages view", () => {
    expect(queryToRemember(at("stage=draft"), at("view=packages"))).toBeNull();
    expect(queryToRemember(at("view=packages"), at("view=kanban"))).toBeNull();
  });

  it("writes nothing away from a Module tab", () => {
    expect(queryToRemember(at("stage=draft"), seenAt(`/en/projects/${project}/settings`, "tab=x"))).toBeNull();
  });
});

describe("the remembered query, per Member, Project and Module (RP-1240)", () => {
  it("comes back on the same Member's same tab only", () => {
    const storage = memoryStorage();
    writeRemembered(storage, member, submittals, "stage=draft");
    expect(readRemembered(storage, member, submittals)).toBe("stage=draft");
    expect(readRemembered(storage, member, { projectId: project, module: "inspections" })).toBe("");
    expect(readRemembered(storage, member, { projectId: otherProject, module: "submittals" })).toBe("");
    expect(readRemembered(storage, otherMember, submittals)).toBe("");
  });

  it("is cleared by an empty query", () => {
    const storage = memoryStorage();
    writeRemembered(storage, member, submittals, "stage=draft");
    writeRemembered(storage, member, submittals, "");
    expect(readRemembered(storage, member, submittals)).toBe("");
    expect(storage.entries.size).toBe(0);
  });

  it("ignores a corrupt or old entry", () => {
    const storage = memoryStorage();
    writeRemembered(storage, member, submittals, "stage=draft");
    const [key] = [...storage.entries.keys()];
    for (const bad of ["not json", "null", "42", '"stage=draft"', "[]", '{"v":0,"query":"stage=draft"}', '{"v":1,"query":7}']) {
      storage.entries.set(key!, bad);
      expect(readRemembered(storage, member, submittals)).toBe("");
    }
  });

  it("reads an entry again as the page would, so a tampered one keeps only valid filters", () => {
    const storage = memoryStorage();
    writeRemembered(storage, member, submittals, "stage=draft");
    const [key] = [...storage.entries.keys()];
    storage.entries.set(key!, JSON.stringify({ v: 1, query: `stage=draft&page=9&open=${project}&stepAgeMin=banana` }));
    expect(readRemembered(storage, member, submittals)).toBe("stage=draft");
  });

  it("works without storage, or when storage throws", () => {
    expect(() => writeRemembered(throwingStorage, member, submittals, "stage=draft")).not.toThrow();
    expect(() => writeRemembered(throwingStorage, member, submittals, "")).not.toThrow();
    expect(readRemembered(throwingStorage, member, submittals)).toBe("");
    expect(readRemembered(null, member, submittals)).toBe("");
  });
});

describe("a link back to a Module tab (RP-1240)", () => {
  it("carries the remembered query", () => {
    const storage = memoryStorage();
    writeRemembered(storage, member, submittals, "stage=draft&view=kanban");
    expect(rememberedHref(storage, member, `/projects/${project}/work-items`)).toBe(`/projects/${project}/work-items?stage=draft&view=kanban`);
  });

  it("keeps a query of its own: the link's query wins", () => {
    const storage = memoryStorage();
    writeRemembered(storage, member, submittals, "stage=draft");
    expect(rememberedHref(storage, member, `/projects/${project}/work-items?needMyAction=true`)).toBe(`/projects/${project}/work-items?needMyAction=true`);
  });

  it("is left as it is with nothing remembered, for another page, or without a Member or storage", () => {
    const storage = memoryStorage();
    expect(rememberedHref(storage, member, `/projects/${project}/work-items`)).toBe(`/projects/${project}/work-items`);
    writeRemembered(storage, member, submittals, "stage=draft");
    expect(rememberedHref(storage, member, `/projects/${project}/settings`)).toBe(`/projects/${project}/settings`);
    expect(rememberedHref(storage, null, `/projects/${project}/work-items`)).toBe(`/projects/${project}/work-items`);
    expect(rememberedHref(null, member, `/projects/${project}/work-items`)).toBe(`/projects/${project}/work-items`);
    expect(rememberedHref(throwingStorage, member, `/projects/${project}/work-items`)).toBe(`/projects/${project}/work-items`);
  });
});
