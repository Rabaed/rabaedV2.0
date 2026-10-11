import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// pnpm demo:session <email or short name> [--out <file>] (RP-543)
//
// Signs in as a demo person against the local web app and writes a Playwright
// storage-state file, so an agent or script can open pages signed in without ever
// seeing the demo password. The password is read here, from .env.demo at the
// repository root (this worktree's own, written by the first `pnpm demo`), and is
// never printed. The only output is the path of the state file.

const root = fileURLToPath(new URL("..", import.meta.url));
const passwordFile = resolve(root, ".env.demo");

/** Short names for the demo people the README lists. Anyone else: use the full email. */
export const demoPeople: Record<string, string> = {
  saeed: "saeed.alqahtani@tmc.demo.rabaed.test",
  hafiz: "hafiz.hamdan@tmc.demo.rabaed.test",
  ali: "ali.sonour@tmc.demo.rabaed.test",
  omar: "omar.alharbi@tmc.demo.rabaed.test",
  yousef: "yousef.karim@betabuild.demo.rabaed.test",
  ahmed: "ahmed.binsaid@designconsultants.demo.rabaed.test",
  sara: "sara@designconsultants.demo.rabaed.test",
  mohammed: "mohammed.alshamsi@designconsultants.demo.rabaed.test",
  faisal: "faisal.alotaibi@alwaha.demo.rabaed.test",
  nasser: "nasser.aldosari@betabuild.demo.rabaed.test",
};

export type DemoSessionArgs = { email: string; short: string; out: string };

/** Reads the command line: one person (email or short name) and an optional --out file. Throws a plain message on bad input. */
export function parseArgs(argv: string[]): DemoSessionArgs {
  let person: string | undefined;
  let out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--out") {
      out = argv[++i];
      if (!out) throw new Error("--out needs a file path.");
    } else if (arg.startsWith("--out=")) {
      out = arg.slice("--out=".length);
      if (!out) throw new Error("--out needs a file path.");
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option ${arg}.`);
    } else if (person === undefined) {
      person = arg;
    } else {
      throw new Error(`Only one person at a time, got "${person}" and "${arg}".`);
    }
  }
  if (!person) throw new Error(`Name a person: an email or one of ${Object.keys(demoPeople).join(", ")}.`);
  const key = person.trim().toLowerCase();
  const email = key.includes("@") ? key : demoPeople[key];
  if (!email) throw new Error(`Unknown short name "${person}". Use an email or one of ${Object.keys(demoPeople).join(", ")}.`);
  const short = key.includes("@") ? key.split("@")[0]!.replace(/[^a-z0-9.-]/g, "") : key;
  return { email, short, out: out ?? resolve(root, ".demo-sessions", `${short}.json`) };
}

/** The DEMO_PASSWORD line of .env.demo, or undefined. */
export function parseDemoPassword(text: string): string | undefined {
  return /^DEMO_PASSWORD=(.+)$/m.exec(text)?.[1]?.trim();
}

export type StateCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Lax" | "Strict" | "None";
};

/** One Set-Cookie header as a Playwright storage-state cookie for the given host. */
export function toStateCookie(setCookie: string, host: string): StateCookie {
  const [pair = "", ...attributes] = setCookie.split(";").map((part) => part.trim());
  const eq = pair.indexOf("=");
  const cookie: StateCookie = {
    name: pair.slice(0, eq),
    value: pair.slice(eq + 1),
    domain: host,
    path: "/",
    expires: -1,
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
  };
  for (const attribute of attributes) {
    const [key = "", ...rest] = attribute.split("=");
    const value = rest.join("=");
    switch (key.toLowerCase()) {
      case "path":
        cookie.path = value || "/";
        break;
      case "expires": {
        const time = Date.parse(value);
        if (!Number.isNaN(time)) cookie.expires = Math.floor(time / 1000);
        break;
      }
      case "max-age": {
        const seconds = Number(value);
        if (Number.isFinite(seconds)) cookie.expires = Math.floor(Date.now() / 1000) + seconds;
        break;
      }
      case "httponly":
        cookie.httpOnly = true;
        break;
      case "secure":
        cookie.secure = true;
        break;
      case "samesite": {
        const v = value.toLowerCase();
        cookie.sameSite = v === "strict" ? "Strict" : v === "none" ? "None" : "Lax";
        break;
      }
    }
  }
  return cookie;
}

/** The Playwright storage-state object for the cookies a sign-in set. */
export function storageState(setCookies: string[], webUrl: string) {
  const host = new URL(webUrl).hostname;
  return { cookies: setCookies.map((header) => toStateCookie(header, host)), origins: [] };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(passwordFile)) {
    throw new Error("No .env.demo in this worktree yet: run `pnpm demo` here once (it creates the password), then try again.");
  }
  const password = parseDemoPassword(readFileSync(passwordFile, "utf8"));
  if (!password) throw new Error(".env.demo has no DEMO_PASSWORD line.");

  const webUrl = (process.env.WEB_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
  // Through the web app's /api/v1 proxy, so the cookie is the browser's first-party one.
  const response = await fetch(`${webUrl}/api/v1/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: args.email, password }),
  }).catch(() => {
    throw new Error(`Could not reach ${webUrl}. Is the demo running (pnpm demo)?`);
  });
  if (response.status !== 204) {
    const hint = response.status === 401 ? " (wrong email, or the seed used another password: run pnpm demo again)" : "";
    throw new Error(`Sign-in as ${args.email} failed with ${response.status}${hint}.`);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length === 0) throw new Error("Sign-in worked but set no session cookie.");

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(storageState(cookies, webUrl), null, 2));
  console.log(args.out);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
