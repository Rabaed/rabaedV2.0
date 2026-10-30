import { describe, expect, it } from "vitest";
import { filesProblem, healthStop, parseServiceStates, stackHealthProblems, type HealthDeps, type ServiceState } from "./verify-health.ts";

const up: ServiceState[] = [
  { service: "db", name: "rabaed-lane31-db-1", state: "running", status: "Up 2 hours (healthy)" },
  { service: "mailpit", name: "rabaed-lane31-mailpit-1", state: "running", status: "Up 2 hours (healthy)" },
  { service: "files", name: "rabaed-lane31-files-1", state: "running", status: "Up 2 hours (healthy)" },
];
const postgres = { lane: "31", host: "localhost", port: 5742 };
const deps = (over: Partial<HealthDeps> = {}): HealthDeps => ({
  project: "rabaed-lane31",
  listServices: () => up,
  postgres,
  dbAnswers: async () => true,
  filesEndpoint: "http://127.0.0.1:9310",
  filesProblem: async () => undefined,
  ...over,
});

describe("parseServiceStates", () => {
  it("reads docker ps's service, name, state and status columns", () => {
    expect(parseServiceStates("db\trabaed-lane31-db-1\texited\tExited (137) 3 minutes ago\n\n")).toEqual([
      { service: "db", name: "rabaed-lane31-db-1", state: "exited", status: "Exited (137) 3 minutes ago" },
    ]);
  });
});

describe("stackHealthProblems", () => {
  it("finds nothing when Docker answers, db and files run healthy, and both answer", async () => {
    expect(await stackHealthProblems(deps())).toEqual([]);
  });

  it("stops at Docker when it does not answer, and checks nothing else", async () => {
    let asked = false;
    const problems = await stackHealthProblems(deps({ listServices: () => undefined, dbAnswers: async () => ((asked = true), true) }));
    expect(problems).toEqual([expect.stringContaining("Docker is not answering")]);
    expect(asked).toBe(false);
  });

  it("names a dead, unhealthy, starting or missing db or files container", async () => {
    const states: ServiceState[] = [
      { service: "db", name: "rabaed-lane31-db-1", state: "exited", status: "Exited (137) 3 minutes ago" },
      { service: "mailpit", name: "rabaed-lane31-mailpit-1", state: "exited", status: "Exited (0)" },
    ];
    const problems = await stackHealthProblems(deps({ listServices: () => states, dbAnswers: async () => false, filesProblem: async () => "no answer" }));
    expect(problems).toContain("db container rabaed-lane31-db-1 is exited (Exited (137) 3 minutes ago).");
    expect(problems).toContain("files (rustfs) has no container in compose project rabaed-lane31.");
    // Mailpit is not needed by verify's steps; Postgres and the file store are not asked once their containers are down.
    expect(problems.join("\n")).not.toContain("mailpit");
    expect(problems).toHaveLength(2);

    const unhealthy = up.map((s) => (s.service === "files" ? { ...s, status: "Up 4 minutes (unhealthy)" } : s.service === "db" ? { ...s, status: "Up 3 seconds (health: starting)" } : s));
    const sick = await stackHealthProblems(deps({ listServices: () => unhealthy }));
    expect(sick).toEqual([
      "db container rabaed-lane31-db-1 is still starting (Up 3 seconds (health: starting)).",
      "files (rustfs) container rabaed-lane31-files-1 is unhealthy (Up 4 minutes (unhealthy)).",
    ]);
  });

  it("says when a running db or file store does not answer on its port", async () => {
    const problems = await stackHealthProblems(deps({ dbAnswers: async () => false, filesProblem: async () => "file store at http://127.0.0.1:9310 is not answering (connect ECONNREFUSED)" }));
    expect(problems).toEqual([
      expect.stringContaining("Postgres for lane 31 (port 5742) is down"),
      "file store at http://127.0.0.1:9310 is not answering (connect ECONNREFUSED)",
    ]);
  });
});

describe("filesProblem", () => {
  it("passes on a 200 from /health, and names the status or the error otherwise", async () => {
    const asked: string[] = [];
    const ok = async (url: string) => (asked.push(url), new Response("ok", { status: 200 }));
    expect(await filesProblem("http://127.0.0.1:9310/", { get: ok })).toBeUndefined();
    expect(asked).toEqual(["http://127.0.0.1:9310/health"]);
    expect(await filesProblem("http://127.0.0.1:9310", { get: async () => new Response("", { status: 503 }) })).toBe("file store at http://127.0.0.1:9310 answers /health with 503.");
    const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED", syscall: "connect" } });
    expect(await filesProblem("http://127.0.0.1:9310", { get: async () => Promise.reject(refused) })).toBe("file store at http://127.0.0.1:9310 is not answering (connect ECONNREFUSED).");
  });
});

describe("healthStop", () => {
  it("lists the problems and says what to do, and what never to do", () => {
    const text = healthStop("rabaed-lane31", ["db container rabaed-lane31-db-1 is exited (Exited (137))."]);
    expect(text).toContain("Lane stack rabaed-lane31 is not healthy, so verify stops before its first step:\n  - db container rabaed-lane31-db-1 is exited");
    expect(text).toContain("docker logs --tail 50 <container>");
    expect(text).toContain("Never restart Docker");
    expect(text).toContain("docker compose up -d --wait db mailpit files");
  });
});
