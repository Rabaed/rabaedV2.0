import { execFileSync } from "node:child_process";
import { postgresDown, startServices } from "./test-services.ts";

// `pnpm verify` checks the lane's stack before its first step (RP-1096): Docker answers, the db
// and file store (rustfs) containers run and are healthy, and both answer on their ports. On
// 2026-10-29 a jammed Docker and a dead rustfs ("init retry budget exhausted") showed only as seam
// suites timing out after 3+ hours. Mailpit is not checked: only the mail suite needs it.

export type ServiceState = { service: string; name: string; state: string; status: string };

/** `docker ps` columns for one compose project's containers: service, name, state ("running", "exited"…) and status ("Up 2 hours (healthy)"). */
const serviceFormat = '{{.Label "com.docker.compose.service"}}\t{{.Names}}\t{{.State}}\t{{.Status}}';

export function parseServiceStates(out: string): ServiceState[] {
  return out
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [service = "", name = "", state = "", status = ""] = line.split("\t");
      return { service, name, state, status };
    });
}

/** How long `docker ps` may take before Docker counts as jammed. */
export const DOCKER_TIMEOUT_MS = 20_000;

/** The compose project's containers, or undefined when Docker does not answer in DOCKER_TIMEOUT_MS (or is not running). */
export function listServiceStates(project: string): ServiceState[] | undefined {
  try {
    const out = execFileSync("docker", ["ps", "-a", "--filter", `label=com.docker.compose.project=${project}`, "--format", serviceFormat], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: DOCKER_TIMEOUT_MS,
    });
    return parseServiceStates(out);
  } catch {
    return undefined;
  }
}

/** Why a request failed, short: the socket error's code ("connect ECONNREFUSED"), else its message. */
function reason(error: unknown): string {
  const e = error as { name?: string; message?: string; cause?: { code?: string; syscall?: string } };
  if (e.name === "TimeoutError") return "no answer in time";
  if (e.cause?.code) return [e.cause.syscall, e.cause.code].filter(Boolean).join(" ");
  return e.message ?? String(error);
}

/** Why the file store at `endpoint` is not well, or undefined when /health answers 200. */
export async function filesProblem(endpoint: string, { get = (url: string) => fetch(url, { signal: AbortSignal.timeout(5_000) }) } = {}): Promise<string | undefined> {
  const base = endpoint.replace(/\/+$/, "");
  try {
    const response = await get(`${base}/health`);
    return response.ok ? undefined : `file store at ${base} answers /health with ${response.status}.`;
  } catch (error) {
    return `file store at ${base} is not answering (${reason(error)}).`;
  }
}

export type HealthDeps = {
  project: string;
  listServices: () => ServiceState[] | undefined;
  postgres: { lane: string; host: string; port: number };
  dbAnswers: () => Promise<boolean>;
  /** FILE_STORE_ENDPOINT from the worktree's .env; undefined skips the file store's port check. */
  filesEndpoint: string | undefined;
  filesProblem: (endpoint: string) => Promise<string | undefined>;
};

// eslint-disable-next-line rabaed/no-avoid-terms -- `files` is the Docker Compose service's name, not a Document
const label: Record<string, string> = { db: "db", files: "files (rustfs)" };

/** A required service's container problem, or undefined when it runs and is healthy (or has no health check). */
function containerProblem(service: "db" | "files", project: string, states: ServiceState[]): string | undefined {
  const c = states.find((s) => s.service === service);
  if (!c) return `${label[service]} has no container in compose project ${project}.`;
  if (c.state !== "running") return `${label[service]} container ${c.name} is ${c.state} (${c.status}).`;
  if (c.status.includes("(unhealthy)")) return `${label[service]} container ${c.name} is unhealthy (${c.status}).`;
  if (c.status.includes("(health: starting)")) return `${label[service]} container ${c.name} is still starting (${c.status}).`;
  return undefined;
}

/** What is wrong with the lane's stack, one line each; none when verify may start. */
export async function stackHealthProblems(deps: HealthDeps): Promise<string[]> {
  const states = deps.listServices();
  if (states === undefined) {
    return [`Docker is not answering (\`docker ps\` gave nothing in ${DOCKER_TIMEOUT_MS / 1000} s): it is stopped or jammed. Tell your Main; do not restart it yourself.`];
  }
  const problems: string[] = [];
  const db = containerProblem("db", deps.project, states);
  if (db) problems.push(db);
  else if (!(await deps.dbAnswers())) problems.push(postgresDown(deps.postgres));
  const files = containerProblem("files", deps.project, states);
  if (files) problems.push(files);
  else if (deps.filesEndpoint !== undefined) {
    const problem = await deps.filesProblem(deps.filesEndpoint);
    if (problem) problems.push(problem);
  }
  return problems;
}

/** The message verify stops with when the stack is not healthy. */
export function healthStop(project: string, problems: string[]): string {
  return [
    `Lane stack ${project} is not healthy, so verify stops before its first step:`,
    ...problems.map((p) => `  - ${p}`),
    "If a container died, send its last lines (`docker logs --tail 50 <container>`) to your Main and stop there; don't retry in a loop.",
    "Never restart Docker, and never `docker rm` or `docker volume rm`.",
    `Once your Main says Docker has room: ${startServices}, then run verify again.`,
  ].join("\n");
}
