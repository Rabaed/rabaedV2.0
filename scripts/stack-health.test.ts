import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { alertCommand, parseHealthArgs, runWhileUp, stackProblems, stoppedMessage, targetOfEnv, targetOfLane } from "./stack-health.ts";

// RP-1099: lane 7 sat at Exited (255) for over 2 hours after a Docker Desktop update, and the
// UAT harness wrote Fail results against the dead stack.

const servers: (Server | HttpServer)[] = [];
const sockets: Socket[] = [];

afterEach(async () => {
  for (const s of sockets.splice(0)) s.destroy();
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
});

const portOf = (s: Server | HttpServer) => (s.address() as AddressInfo).port;

async function listen<T extends Server | HttpServer>(server: T): Promise<T> {
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return server;
}

/** An api whose GET /health answers `status` with `body`. */
const api = (status: number, body: object) =>
  listen(
    createHttpServer((req, res) => {
      res.writeHead(req.url === "/health" ? status : 404, { "content-type": "application/json" });
      res.end(JSON.stringify(req.url === "/health" ? body : { error: "not found" }));
    }),
  );

/** A Postgres stand-in: answers the 8-byte SSLRequest with "N" (no SSL), as Postgres does. */
const postgres = () =>
  listen(
    createServer((socket) => {
      sockets.push(socket);
      socket.once("data", (data) => {
        if (data.length === 8 && data.readInt32BE(4) === 80877103) socket.write("N");
      });
    }),
  );

/** Accepts connections and never answers. */
const silent = () => listen(createServer((socket) => void sockets.push(socket)));

/** A port nothing listens on (bound, then closed). */
async function closedPort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((done) => s.listen(0, "127.0.0.1", done));
  const port = portOf(s);
  await new Promise((done) => s.close(done));
  return port;
}

/** A Postgres port that answers the SSLRequest with `byte`, or closes the connection at once (null). */
const answers = (byte: string | null) =>
  listen(
    createServer((socket) => {
      sockets.push(socket);
      if (byte === null) socket.destroy();
      else socket.once("data", () => socket.write(byte));
    }),
  );

/** An api whose /health answers 200 with a body that is not JSON. */
const notJson = () =>
  listen(
    createHttpServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html>Bad gateway</html>");
    }),
  );

const healthy = { status: "ok", database: "ok", version: "test" };
const fast = { timeoutMs: 400 };
const target = (apiPort: number, dbPort: number) => ({ apiUrl: `http://127.0.0.1:${apiPort}`, dbHost: "127.0.0.1", dbPort });

describe("stackProblems", () => {
  it("finds none when the api's /health is ok and Postgres answers", async () => {
    const [a, db] = await Promise.all([api(200, healthy), postgres()]);
    expect(await stackProblems(target(portOf(a), portOf(db)), fast)).toEqual([]);
  });

  it("names the api when nothing answers on its port", async () => {
    const [port, db] = await Promise.all([closedPort(), postgres()]);
    const problems = await stackProblems(target(port, portOf(db)), fast);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(new RegExp(`^api at http://127\\.0\\.0\\.1:${port} is not answering`));
  });

  it("says the api cannot reach the database when /health answers 503", async () => {
    const [a, db] = await Promise.all([api(503, { status: "degraded", database: "unavailable", version: "test" }), postgres()]);
    const problems = await stackProblems(target(portOf(a), portOf(db)), fast);
    expect(problems).toEqual([`api at http://127.0.0.1:${portOf(a)} answers /health with 503: database unavailable`]);
  });

  it("names the api when /health times out", async () => {
    const [a, db] = await Promise.all([silent(), postgres()]);
    const problems = await stackProblems(target(portOf(a), portOf(db)), fast);
    expect(problems).toEqual([`api at http://127.0.0.1:${portOf(a)} is not answering (no answer in 0.4 s)`]);
  });

  it("names the db when nothing answers on its port", async () => {
    const [a, port] = await Promise.all([api(200, healthy), closedPort()]);
    const problems = await stackProblems(target(portOf(a), port), fast);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(new RegExp(`^db at 127\\.0\\.0\\.1:${port} is not answering`));
  });

  it("names the db when its port takes the connection but never answers as Postgres", async () => {
    const [a, db] = await Promise.all([api(200, healthy), silent()]);
    const problems = await stackProblems(target(portOf(a), portOf(db)), fast);
    expect(problems).toEqual([`db at 127.0.0.1:${portOf(db)} is not answering (no answer in 0.4 s)`]);
  });

  it("names the api when /health answers 200 but not ok, or not JSON", async () => {
    const [degraded, html, db] = await Promise.all([api(200, { status: "degraded", database: "ok", version: "test" }), notJson(), postgres()]);
    expect(await stackProblems(target(portOf(degraded), portOf(db)), fast)).toEqual([`api at http://127.0.0.1:${portOf(degraded)} answers /health with 200: status degraded`]);
    expect(await stackProblems(target(portOf(html), portOf(db)), fast)).toEqual([`api at http://127.0.0.1:${portOf(html)} answers /health with 200: status missing`]);
  });

  it("takes S (SSL offered) as Postgres too", async () => {
    const [a, db] = await Promise.all([api(200, healthy), answers("S")]);
    expect(await stackProblems(target(portOf(a), portOf(db)), fast)).toEqual([]);
  });

  it("names the db when its port answers something other than Postgres, or closes at once", async () => {
    const [a, other, closing] = await Promise.all([api(200, healthy), answers("H"), answers(null)]);
    expect(await stackProblems(target(portOf(a), portOf(other)), fast)).toEqual([`db at 127.0.0.1:${portOf(other)} is not answering (not Postgres: answered "H")`]);
    const [problem] = await stackProblems(target(portOf(a), portOf(closing)), fast);
    expect(problem).toMatch(new RegExp(`^db at 127\\.0\\.0\\.1:${portOf(closing)} is not answering \\((closed the connection|read ECONNRESET)\\)$`));
  });

  it("names both when the whole stack is down", async () => {
    const [apiPort, dbPort] = await Promise.all([closedPort(), closedPort()]);
    const problems = await stackProblems(target(apiPort, dbPort), fast);
    expect(problems.map((p) => p.split(" ")[0])).toEqual(["api", "db"]);
  });
});

describe("targets", () => {
  it("reads a lane's ports: lane 7 is the UAT harness stack", () => {
    expect(targetOfLane(7)).toEqual({ apiUrl: "http://127.0.0.1:4700", dbHost: "127.0.0.1", dbPort: 6132 });
  });

  it("reads API_URL and POSTGRES_PORT from a lane's .env, and falls back to lane 7", () => {
    expect(targetOfEnv({ API_URL: "http://127.0.0.1:4530/", POSTGRES_PORT: "5962" })).toEqual({ apiUrl: "http://127.0.0.1:4530", dbHost: "127.0.0.1", dbPort: 5962 });
    expect(targetOfEnv({})).toEqual(targetOfLane(7));
  });

  it("refuses an .env value that names no stack, instead of checking a wrong one", () => {
    expect(() => targetOfEnv({ POSTGRES_PORT: "abc" })).toThrow(/POSTGRES_PORT "abc" is not a port/);
    expect(() => targetOfEnv({ API_URL: "" })).toThrow(/API_URL "" is not an http address/);
  });
});

describe("parseHealthArgs", () => {
  it("takes a lane and --alert", () => {
    expect(parseHealthArgs(["--lane", "7", "--alert"])).toEqual({ lane: 7, alert: true });
    expect(parseHealthArgs([])).toEqual({ lane: undefined, alert: false });
  });

  it("refuses a lane that is not one, and an unknown flag", () => {
    expect(() => parseHealthArgs(["--lane", "60"])).toThrow(/not a lane/);
    expect(() => parseHealthArgs(["--lane"])).toThrow(/--lane needs/);
    expect(() => parseHealthArgs(["--watch"])).toThrow(/Unknown argument --watch/);
  });
});

describe("stoppedMessage", () => {
  it("says no Pass or Fail was written, lists each problem, and says not to start Docker", () => {
    const message = stoppedMessage(["api at http://127.0.0.1:4700 is not answering (connect ECONNREFUSED)", "db at 127.0.0.1:6132 is not answering (connect ECONNREFUSED)"]);
    expect(message).toContain("UAT stopped: the stack is down, so no Pass or Fail was written.");
    expect(message).toContain("  - api at http://127.0.0.1:4700 is not answering (connect ECONNREFUSED)\n  - db at 127.0.0.1:6132");
    expect(message).toMatch(/do not start or restart Docker/);
  });

  it("names the case it wrote nothing for", () => {
    expect(stoppedMessage(["db at 127.0.0.1:6132 is not answering (connect ECONNREFUSED)"], "VIS-03")).toContain(
      "UAT stopped at VIS-03: the stack is down, so nothing was written for VIS-03. What was written before it is kept.",
    );
  });
});

describe("runWhileUp", () => {
  // The harness's case and fixture loops: a result taken while the stack was down is never saved.
  /** A run over `items` whose stack check answers `downAt(check number)`; records what ran and was saved. */
  async function track(items: string[], downAt: (check: number) => string | undefined) {
    const log: string[] = [];
    let checks = 0;
    const outcome = await runWhileUp(items, {
      down: async (item) => {
        log.push(`check ${item}`);
        return downAt(++checks);
      },
      run: async (item) => (log.push(`run ${item}`), `result ${item}`),
      save: (item, result) => void log.push(`save ${item}: ${result}`),
    });
    return { outcome, log };
  }

  it("saves every result while the stack stays up, checking before and after each", async () => {
    const { outcome, log } = await track(["A", "B"], () => undefined);
    expect(outcome).toEqual({ saved: 2, stopped: undefined });
    expect(log).toEqual(["check A", "run A", "check A", "save A: result A", "check B", "run B", "check B", "save B: result B"]);
  });

  it("runs and saves nothing when the stack is down before the first item", async () => {
    const { outcome, log } = await track(["A", "B"], () => "db down");
    expect(outcome).toEqual({ saved: 0, stopped: "db down" });
    expect(log).toEqual(["check A"]);
  });

  it("does not save an item when the stack went down while it ran, and stops there", async () => {
    // Checks: 1 before A, 2 after A, 3 before B, 4 after B (down).
    const { outcome, log } = await track(["A", "B", "C"], (n) => (n === 4 ? "api down" : undefined));
    expect(outcome).toEqual({ saved: 1, stopped: "api down" });
    expect(log).toEqual(["check A", "run A", "check A", "save A: result A", "check B", "run B", "check B"]);
  });

  it("stops before running the next item when the stack is down before it, keeping what was saved", async () => {
    // Checks: 1 before A, 2 after A, 3 before B (down).
    const { outcome, log } = await track(["A", "B"], (n) => (n === 3 ? "db down" : undefined));
    expect(outcome).toEqual({ saved: 1, stopped: "db down" });
    expect(log).toEqual(["check A", "run A", "check A", "save A: result A", "check B"]);
  });

  it("tells the check whether it is before or after the item, so a fixture cut off midway can say it may be partial", async () => {
    const asked: string[] = [];
    const outcome = await runWhileUp(["FX-C2"], {
      down: async (item, when) => (asked.push(`${when} ${item}`), when === "after" ? `${item} may be partial` : undefined),
      run: async () => "applied",
      save: () => {},
    });
    expect(asked).toEqual(["before FX-C2", "after FX-C2"]);
    expect(outcome).toEqual({ saved: 0, stopped: "FX-C2 may be partial" });
  });
});

describe("alertCommand", () => {
  // Toasts are off on the owner's machine (ToastEnabled 0), so the alert is a message box that
  // stays on top until clicked; the task waits on it, so no second one stacks up behind it.
  it("shows a message box that stays until clicked, passing the text in the environment, never in the script", () => {
    const title = "Rabaed lane 7 is down";
    const body = `api at http://127.0.0.1:4700 is not answering'; Remove-Item C:\\ -Recurse; '`;
    const { file, args, env } = alertCommand(title, body);
    expect(file).toBe("powershell.exe");
    expect(args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-Command"]);
    const script = args.at(-1) ?? "";
    expect(script).toContain("WScript.Shell");
    // No timeout (0 s); 4096 system modal (on top of every window) + 48 the warning icon.
    expect(script).toContain(".Popup($env:RABAED_ALERT_BODY, 0, $env:RABAED_ALERT_TITLE, 4144)");
    expect(script).not.toContain("Remove-Item");
    expect(script).not.toContain(title);
    expect(env).toEqual({ RABAED_ALERT_TITLE: title, RABAED_ALERT_BODY: body });
  });
});
