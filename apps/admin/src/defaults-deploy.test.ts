import { describe, expect, it } from "vitest";
import { publishDefaultsForDeploy, type DeployPublisher } from "./defaults-deploy.ts";
import type { PublishDefaultsResult } from "./rabaed-defaults.ts";

// The deploy's publish step (RP-1205): what deploy-uat.yml runs after the migrations. The public
// repository's run logs and step summaries show everything it prints, so it prints counts and
// Form, Workflow and Screen keys only. These tests stand a fake publisher in for the database.
const request = { engineerEmail: "engineer@rabaed.demo.rabaed.test", reason: "Deploy 4a0a58d" };

function run(publisher: Partial<DeployPublisher>, input = request) {
  const out: string[] = [];
  const err: string[] = [];
  const full: DeployPublisher = {
    findEngineer: async () => "engineer-id",
    publish: async () => ({ ok: true, done: [], moved: [] }),
    ...publisher,
  };
  return publishDefaultsForDeploy(full, input, { log: (line) => out.push(line), error: (line) => err.push(line) }).then((code) => ({ code, out: out.join("\n"), err: err.join("\n") }));
}

describe("the deploy's publish of the Rabaed Defaults", () => {
  it("lists what it published by key and counts the rest", async () => {
    const result: PublishDefaultsResult = {
      ok: true,
      done: [
        { kind: "screen", name: "code_a", versionNo: 2, published: false },
        { kind: "form", name: "MAR", versionNo: 7, published: true },
        { kind: "form", name: "SAR", versionNo: 3, published: false },
        { kind: "workflow", name: "MAR", versionNo: 4, published: true, warnings: ["a_warning: Some text that may name anything"] },
      ],
      moved: [{ type: "MAR", moved: 2 }],
    };
    const { code, out, err } = await run({ publish: async () => result });
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toContain("published 2, unchanged 2");
    expect(out).toContain("form MAR: Version 7");
    expect(out).toContain("workflow MAR: Version 4");
    expect(out).not.toContain("code_a");
    expect(out).toContain("1 warning");
    expect(out).not.toContain("Some text");
    expect(out).toContain("open items moved off a retired Version: 2");
  });

  it("publishes nothing on a second run and says so", async () => {
    const result: PublishDefaultsResult = {
      ok: true,
      done: [
        { kind: "form", name: "MAR", versionNo: 7, published: false },
        { kind: "workflow", name: "MAR", versionNo: 4, published: false },
      ],
      moved: [{ type: "MAR", moved: 0 }],
    };
    const { code, out } = await run({ publish: async () => result });
    expect(code).toBe(0);
    expect(out).toContain("nothing to publish");
    expect(out).toContain("published 0, unchanged 2");
    expect(out).not.toContain("moved off");
  });

  it("fails on a refusal, naming the document and the reason with counts only", async () => {
    const result: PublishDefaultsResult = {
      ok: false,
      kind: "workflow",
      name: "WIR",
      result: { ok: false, reason: "projects_lack_entries", projects: 3, outcomes: ["code_x", "code_y"], stages: [] } as never,
    };
    const { code, out, err } = await run({ publish: async () => result });
    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toContain("workflow WIR");
    expect(err).toContain("projects_lack_entries");
    expect(err).toContain("projects: 3");
    expect(err).toContain("outcomes: 2");
    expect(err).not.toContain("code_x");
    expect(err).toContain("nothing more was published");
  });

  it("names the codes of a refusal's problems but not their text", async () => {
    const result: PublishDefaultsResult = {
      ok: false,
      kind: "form",
      name: "MAR",
      result: { ok: false, reason: "schema_problems", problems: [{ code: "field_missing", message: { en: "Contact jo@example.com" } }] } as never,
    };
    const { err } = await run({ publish: async () => result });
    expect(err).toContain("form MAR");
    expect(err).toContain("field_missing");
    expect(err).not.toContain("jo@example.com");
    expect(err).not.toContain("Contact");
  });

  it("fails when the Engineer is not active, without naming them", async () => {
    const { code, err } = await run({ findEngineer: async () => null });
    expect(code).toBe(1);
    expect(err).toContain("No active Rabaed Engineer");
    expect(err).not.toContain(request.engineerEmail);
  });

  it("does not publish when the Engineer is not found", async () => {
    let published = false;
    await run({
      findEngineer: async () => null,
      publish: async () => {
        published = true;
        return { ok: true, done: [], moved: [] };
      },
    });
    expect(published).toBe(false);
  });

  it("masks an email or a URL in anything it prints", async () => {
    const result: PublishDefaultsResult = {
      ok: true,
      done: [{ kind: "form", name: "ana@example.com https://db.example.com/x", versionNo: 1, published: true }],
      moved: [],
    };
    const { out } = await run({ publish: async () => result });
    expect(out).not.toContain("ana@example.com");
    expect(out).not.toContain("db.example.com");
    expect(out).toContain("<email>");
    expect(out).toContain("<url>");
  });

  it("keeps the key of an earlier Workflow Version, which is no email", async () => {
    const result: PublishDefaultsResult = { ok: true, done: [{ kind: "workflow", name: "WIR@2", versionNo: 2, published: true }], moved: [] };
    const { out } = await run({ publish: async () => result });
    expect(out).toContain("workflow WIR@2: Version 2");
  });

  it("fails loudly on an error, printing neither its message nor the connection it names", async () => {
    // Built from parts: no connection string with a password sits in the repository (secret-scan).
    const password = ["hunt", "er2"].join("");
    const connection = ["postgres", "://", "migrator:", password, "@db.example.com:5432/rabaed_uat"].join("");
    const failure = Object.assign(new Error(`connect ECONNREFUSED ${connection} for ana@example.com`), { code: "ECONNREFUSED" });
    const { code, out, err } = await run({
      publish: async () => {
        throw failure;
      },
    });
    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toContain("failed");
    expect(err).toContain("ECONNREFUSED");
    for (const secret of [password, "db.example.com", "ana@example.com", "rabaed_uat"]) expect(err).not.toContain(secret);
  });

  it("passes the reason to the publish and never prints it", async () => {
    let seen: [string, string] | undefined;
    const { out } = await run({
      publish: async (engineerId, reason) => {
        seen = [engineerId, reason];
        return { ok: true, done: [], moved: [] };
      },
    });
    expect(seen).toEqual(["engineer-id", request.reason]);
    expect(out).not.toContain(request.reason);
  });
});
