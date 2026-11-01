import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// pnpm demo:session [--uat] <email or short name> [--out <file>] (RP-543, RP-1199)
//
// Signs in as a demo person against the local web app and writes a Playwright
// storage-state file, so an agent or script can open pages signed in without ever
// seeing the demo password. The password is read here, from .env.demo at the
// repository root (this worktree's own, written by the first `pnpm demo`), and is
// never printed. The only output is the path of the state file.
//
// With --uat it signs in to https://rabaed-uat-web.vercel.app instead (display checks
// only). The password then comes only from the environment variable UAT_DEMO_PASSWORD,
// which the owner sets in their own git-ignored environment; never from a file and never
// printed. WEB_URL is ignored, and any host but the UAT web one (production included)
// is refused (assertUatWebUrl).

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

export type DemoSessionArgs = { email: string; short: string; out: string; uat: boolean };

/** Reads the command line: one person (email or short name), an optional --out file and the --uat switch. Throws a plain message on bad input. */
export function parseArgs(argv: string[]): DemoSessionArgs {
  let person: string | undefined;
  let out: string | undefined;
  let uat = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--uat") {
      uat = true;
    } else if (arg === "--out") {
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
  const { email, short } = resolvePerson(person);
  return { email, short, out: out ?? resolve(root, ".demo-sessions", `${short}.json`), uat };
}

/** A demo person's email and short name, from an email or one of demoPeople's short names. Throws a plain message on an unknown name. */
export function resolvePerson(person: string): { email: string; short: string } {
  const key = person.trim().toLowerCase();
  const email = key.includes("@") ? key : demoPeople[key];
  if (!email) throw new Error(`Unknown short name "${person}". Use an email or one of ${Object.keys(demoPeople).join(", ")}.`);
  const short = key.includes("@") ? key.split("@")[0]!.replace(/[^a-z0-9.-]/g, "") : key;
  return { email, short };
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

/**
 * Whether the host is `localhost` or a name under it (`lane2.localhost`). Browsers and curl send
 * these to loopback themselves, but Node's resolver on Windows asks DNS and gets ENOTFOUND.
 */
export function isLocalhostName(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, "");
  return name === "localhost" || name.endsWith(".localhost");
}

/**
 * A resolver for node:http that answers 127.0.0.1 for `*.localhost` and asks the system for
 * anything else. Only the connection goes to loopback: the Host header stays the original name,
 * so the web app sees the same request a browser on `laneN.localhost` makes.
 */
export const loopbackForLocalhost: LookupFunction = (hostname, options, callback) => {
  if (!isLocalhostName(hostname)) return dnsLookup(hostname, options, callback as never);
  if (options.all) (callback as (error: null, addresses: LookupAddress[]) => void)(null, [{ address: "127.0.0.1", family: 4 }]);
  else callback(null, "127.0.0.1", 4);
};

/** POSTs JSON with node:http, so `*.localhost` connects through loopbackForLocalhost (fetch takes no lookup). */
export function postJson(url: string, body: unknown): Promise<{ status: number; setCookies: string[] }> {
  const target = new URL(url);
  const payload = JSON.stringify(body);
  const send = target.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolvePost, reject) => {
    const req = send(
      target,
      {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
        // eslint-disable-next-line rabaed/no-avoid-terms -- `lookup` is the node:http option that resolves the host name.
        lookup: loopbackForLocalhost,
      },
      (res) => {
        res.resume();
        res.on("end", () => resolvePost({ status: res.statusCode ?? 0, setCookies: res.headers["set-cookie"] ?? [] }));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

/** The one host `--uat` signs in to (ADR 0026: the UAT web app on Vercel). */
export const UAT_WEB_HOST = "rabaed-uat-web.vercel.app";
export const UAT_WEB_URL = `https://${UAT_WEB_HOST}`;

const REFUSAL = "--uat signs in to the UAT web host only";

/** Whether a host name is a production one: rabaed.com, rabaedapp.com (and any name under them), or any name with "prod" in it. */
function isProductionHost(host: string): boolean {
  return /(^|\.)rabaed\.com$/.test(host) || /(^|\.)rabaedapp\.com$/.test(host) || host.includes("prod");
}

/**
 * The guard for `--uat`: returns the UAT web origin when `url` is exactly `https://rabaed-uat-web.vercel.app`
 * (a trailing slash or the default port is fine), and throws a plain message for anything else: another host,
 * a look-alike, http, userinfo, another port, a path, a query, localhost. Production is refused by name.
 * The message names the host only, never the userinfo, path or query of what was passed.
 */
export function assertUatWebUrl(url: string): string {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new Error(`Refused: the address is not a URL. ${REFUSAL}.`);
  }
  const host = target.hostname;
  if (isProductionHost(host)) throw new Error(`Refused: ${host} is production. ${REFUSAL}.`);
  const exact =
    target.protocol === "https:" &&
    host === UAT_WEB_HOST &&
    target.username === "" &&
    target.password === "" &&
    target.port === "" &&
    target.pathname === "/" &&
    target.search === "" &&
    target.hash === "";
  if (!exact) throw new Error(`Refused: ${host || "that address"} is not the UAT web host (https://${UAT_WEB_HOST}). ${REFUSAL}.`);
  return UAT_WEB_URL;
}

/** This worktree's web app address: WEB_URL from the environment (`.env`), without a trailing slash. */
export const webUrlFromEnv = () => (process.env.WEB_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");

/** What differs between the local sign-in and the UAT one: where the password comes from, and what to say when it fails. */
type SignInSource = {
  /** Returns the password, or throws a plain message that does not hold it. Called only once the address is accepted. */
  getPassword: () => string;
  /** The advice after a 401, with no value in it. */
  unauthorizedHint: string;
  /** The advice when the address cannot be reached. */
  unreachableHint: string;
  postJson?: typeof postJson;
};

/**
 * Signs `email` in at `webUrl` and returns the Playwright storage state. The password comes from
 * `source.getPassword()` and goes only into the sign-in request: never into a message or the result,
 * and a non-204 answer reports its status only, never the response.
 */
async function signInWith(email: string, webUrl: string, source: SignInSource) {
  const password = source.getPassword();
  const post = source.postJson ?? postJson;

  // Through the web app's /api/v1 proxy, so the cookie is the browser's first-party one.
  // A lane's WEB_URL is http://laneN.localhost:<port>: postJson connects to 127.0.0.1 but keeps
  // that Host, and the cookies below are for laneN.localhost, the host the README says to open.
  // The transport error is dropped on purpose: it could echo the request.
  const response = await post(`${webUrl}/api/v1/session`, { email, password }).catch(() => {
    throw new Error(`Could not reach ${webUrl}. ${source.unreachableHint}`);
  });
  if (response.status !== 204) {
    const hint = response.status === 401 ? ` ${source.unauthorizedHint}` : "";
    throw new Error(`Sign-in as ${email} failed with ${response.status}${hint}.`);
  }
  const cookies = response.setCookies;
  if (cookies.length === 0) throw new Error("Sign-in worked but set no session cookie.");
  return storageState(cookies, webUrl);
}

/** Signs `email` in at `webUrl` with this worktree's demo password (.env.demo). */
export async function signIn(email: string, webUrl: string) {
  return signInWith(email, webUrl, {
    getPassword: () => {
      if (!existsSync(passwordFile)) {
        throw new Error("No .env.demo in this worktree yet: run `pnpm demo` here once (it creates the password), then try again.");
      }
      const password = parseDemoPassword(readFileSync(passwordFile, "utf8"));
      if (!password) throw new Error(".env.demo has no DEMO_PASSWORD line.");
      return password;
    },
    unauthorizedHint: "(wrong email, or the seed used another password: run pnpm demo again)",
    unreachableHint: "Is the demo running (pnpm demo)?",
  });
}

/** The one place `--uat` gets its password: this variable, set by the owner in their own git-ignored environment. */
export const UAT_PASSWORD_VARIABLE = "UAT_DEMO_PASSWORD";

export type UatSignInOptions = {
  /** Where the password variable is read from; the process environment unless a test passes its own. */
  env?: Record<string, string | undefined>;
  /** The sign-in request; a test passes a fake so nothing leaves the machine. */
  postJson?: typeof postJson;
  /** Defaults to the UAT web address; anything else is refused by assertUatWebUrl. */
  webUrl?: string;
};

/**
 * Signs `email` in at the UAT web host (RP-1199) with the password in UAT_DEMO_PASSWORD and returns the
 * Playwright storage state. The address is checked first and WEB_URL is never read. The password is
 * never printed, logged or put in an error.
 */
export async function signInUat(email: string, options: UatSignInOptions = {}) {
  const webUrl = assertUatWebUrl(options.webUrl ?? UAT_WEB_URL);
  const env = options.env ?? process.env;
  return signInWith(email, webUrl, {
    getPassword: () => {
      const password = env[UAT_PASSWORD_VARIABLE];
      if (password === undefined || password.trim() === "") {
        throw new Error(`${UAT_PASSWORD_VARIABLE} is not set. Set it in your own git-ignored environment (see .env.example); this script never prints it.`);
      }
      return password;
    },
    unauthorizedHint: `(wrong email, or ${UAT_PASSWORD_VARIABLE} is not the UAT demo password)`,
    unreachableHint: "Is the UAT deployed?",
    ...(options.postJson ? { postJson: options.postJson } : {}),
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const state = args.uat ? await signInUat(args.email) : await signIn(args.email, webUrlFromEnv());
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(state, null, 2));
  console.log(args.out);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
