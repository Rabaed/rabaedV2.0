import type { ProjectSummary } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { filterProjects } from "./projects-browser.tsx";

// Test data only (the package has no translations of its own).
const b = (en: string, ar: string) => Object.fromEntries([["en", en], ["ar", ar]]) as ProjectSummary["name"];
const project = (code: string, name: ProjectSummary["name"], status: ProjectSummary["status"]): ProjectSummary => ({
  id: code,
  projectNumber: 1,
  code,
  name,
  status,
  hostCompany: { legalName: b("Tamkeen", "تمكين") },
  projectRole: { baseRole: "contractor", name: b("Contractor", "المقاول") },
  isProjectAdmin: false,
  needMyAction: 0,
  modules: ["submittals"],
});

const projects = [
  project("TWR", b("Riyadh Gate Tower", "برج بوابة الرياض"), "active"),
  project("KAFD2", b("KAFD Offices", "مكاتب كافد"), "active"),
  project("DMM", b("Dammam Logistics Hub", "مركز الدمام اللوجستي"), "closed"),
];

describe("filterProjects", () => {
  it("shows every Project for no search on All", () => {
    expect(filterProjects(projects, "", "all")).toHaveLength(3);
    expect(filterProjects(projects, "   ", "all")).toHaveLength(3);
  });

  it("finds by code or name, in either language, ignoring case", () => {
    expect(filterProjects(projects, "twr", "all").map((p) => p.code)).toEqual(["TWR"]);
    expect(filterProjects(projects, "logistics", "all").map((p) => p.code)).toEqual(["DMM"]);
    expect(filterProjects(projects, "كافد", "all").map((p) => p.code)).toEqual(["KAFD2"]);
  });

  it("keeps only Active or only Closed Projects, and combines with a search", () => {
    expect(filterProjects(projects, "", "active").map((p) => p.code)).toEqual(["TWR", "KAFD2"]);
    expect(filterProjects(projects, "", "closed").map((p) => p.code)).toEqual(["DMM"]);
    expect(filterProjects(projects, "tower", "closed")).toEqual([]);
  });
});
