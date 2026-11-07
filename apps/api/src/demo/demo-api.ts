import type { FastifyInstance } from "fastify";
import { SESSION_COOKIE } from "../app.ts";

// What the demo seed (seed.ts) and the sample Project (sample-project.ts, RP-1217) share: the api
// called in-process like one browser, and the demo people's made-up emails.

type Method = "GET" | "POST" | "PUT" | "PATCH";
/** An API call; `T` is the answer's shape where the seed reads it. */
export type Call = <T = unknown>(method: Method, url: string, body?: unknown) => Promise<T>;

/** Calls the API in-process like one browser, keeping its session cookie; any failure stops the seed. */
export function browser(app: FastifyInstance): Call {
  let token: string | undefined;
  return async <T>(method: Method, url: string, body?: unknown): Promise<T> => {
    const res = await app.inject({
      method,
      url,
      cookies: token ? { [SESSION_COOKIE]: token } : {},
      ...(body === undefined ? {} : { payload: body as object }),
    });
    const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
    if (set) token = set.value || undefined;
    if (res.statusCode >= 400) throw new Error(`Demo seed: ${method} ${url} answered ${res.statusCode} ${res.body}`);
    return (res.body ? res.json() : null) as T;
  };
}

/** Seconds since `since` (a performance.now()), to a tenth, as the seed's timing lines print them (RP-1254). */
export const secondsSince = (since: number) => `${((performance.now() - since) / 1000).toFixed(1)} s`;

/** What every demo person's email ends with (the reserved .test domain): only the demo's people have it. */
export const DEMO_EMAIL_SUFFIX = ".demo.rabaed.test";
/** A demo person's email: `hafiz.hamdan` at `tmc` → hafiz.hamdan@tmc.demo.rabaed.test. */
export const demoEmail = (local: string, domain: string) => `${local}@${domain}${DEMO_EMAIL_SUFFIX}`;

/** A small photo of a sample luminaire (a JPEG, 96 × 64), for the demo MAR's Sample photo and the sample Project's photos. */
export const SAMPLE_PHOTO_JPEG =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCABAAGADASIAAhEBAxEB/8QAGQABAQEBAQEAAAAAAAAAAAAAAAUEAQMG/8QALxAAAQICBgkEAwEAAAAAAAAAAAEEAgMFERIUFdEhUlNUc5GTorETNUbBBiJB8f/EABcBAQEBAQAAAAAAAAAAAAAAAAABAgP/xAAXEQEBAQEAAAAAAAAAAAAAAAAAAQIR/9oADAMBAAIRAxEAPwD60AFQB4uHUltZ9aOzarq0Kvg8cUZ7btXIDYDHijPbdq5DFGe27VyA2Ax4oz23auQxRntu1cgNgMeKM9t2rkekh63cRrBJmWokSuqpU0AaAAAAAE6koUifMIYkRYVmVKipoXTCV7i03WR00JNIe4UfxfuEvE0sZ7i03WR00FxabrI6aGg6c7ris1wabrI6aC4tN1kdNDScUTXTjPcWm6yOmhIly4JX5A5glwQwQpLSqGFKkTRCXyF8jdcNPEJuJW8AGkAABPpD3Cj+L9wl4g0h7hR/F+4S8Z0sDpwVmLOq6cUVgScAhfI3XDTxCXSF8jdcNPEJvKVvABpAAAZnjKW8sepFGliuqyqf3/DNgrbXm80yKQAm4K215vNMhgrbXm80yKQKJuCttebzTIYK215vNMikAJuCttebzTI9mlHymk1ZkuKNVVLP7KmRsBAAAH//2Q==";
