import { connect } from "node:net";

// The Docker services a test suite needs, checked before it runs (RP-362 retro), so
// a stopped container fails at once with what to do instead of as a database or fetch
// error deep inside a test. Listed first in each suite's globalSetup (vitest.config.ts):
// seam1 and seam2 need Postgres and the file store (the demo seed uploads files), mail
// needs Mailpit, which is waited for briefly since it answers a moment after starting.

const fix = "run `docker compose up -d --wait db mailpit files`";

/** The message for a service that doesn't answer. */
export const unreachable = (name: string, port: number) => `${name} for this worktree (port ${port}) isn't reachable: ${fix}.`;

const defaultPorts: Record<string, number> = { "postgres:": 5432, "postgresql:": 5432, "http:": 80, "https:": 443 };

/** A service URL's host and port, e.g. localhost and 5932 for postgres://u:p@localhost:5932/rabaed. */
export function hostAndPort(url: string): { host: string; port: number } {
  const parsed = new URL(url);
  return { host: parsed.hostname.replace(/^\[(.*)\]$/, "$1") || "localhost", port: Number(parsed.port) || defaultPorts[parsed.protocol] || 80 };
}

/** Whether something accepts a TCP connection on host:port within timeoutMs. */
export function tcpReachable(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.once("timeout", () => done(false));
  });
}

export type Service = { name: string; url: string | undefined };

/** Throws one message naming every service that doesn't accept a connection. A service without a URL is not checked. */
export async function checkReachable(services: Service[], reachable = tcpReachable): Promise<void> {
  const problems: string[] = [];
  for (const { name, url } of services) {
    if (!url) continue;
    const { host, port } = hostAndPort(url);
    if (!(await reachable(host, port))) problems.push(unreachable(name, port));
  }
  if (problems.length > 0) throw new Error(problems.join("\n"));
}

/** Waits up to timeoutMs for Mailpit's /readyz to answer 200; throws the unreachable message if it never does. */
export async function waitForMailpit(url: string, { timeoutMs = 10_000, intervalMs = 250, get = fetch } = {}): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await get(new URL("/readyz", url), { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    if (Date.now() >= deadline) throw new Error(unreachable("Mailpit", hostAndPort(url).port));
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Vitest global setup: checks the services of the project it runs for. */
export default async function setup(project: { name: string }): Promise<void> {
  if (project.name === "mail") {
    if (process.env.MAIL_CATCHER_URL) await waitForMailpit(process.env.MAIL_CATCHER_URL);
    return;
  }
  await checkReachable([
    { name: "Postgres", url: process.env.DATABASE_SUPERUSER_URL ?? process.env.DATABASE_MIGRATOR_URL },
    { name: "The file store", url: process.env.FILE_STORE_ENDPOINT },
  ]);
}
