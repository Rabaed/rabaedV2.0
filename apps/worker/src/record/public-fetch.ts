import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, isIPv4, type LookupFunction } from "node:net";

// The fetch for addresses a certificate names (RP-1085): the CRL, OCSP and
// caIssuers addresses of the sealing and timestamp chains (revocation.ts). A
// CA's address is outside Rabaed's control, so the worker reaches public
// addresses only: never the task's metadata endpoint, the VPC or itself.

/** The most an answer may be: large public CRLs run to a few MB. */
export const MAX_ANSWER_BYTES = 20 * 1024 * 1024;

/** Why an address is refused, or null when the worker may connect to it. */
export type AddressCheck = (address: string) => string | null;

/** 169.254.169.254 (EC2 and ECS instance metadata) and 169.254.170.2 (ECS task metadata and credentials). */
const METADATA_V4 = new Set(["169.254.169.254", "169.254.170.2"]);

const withoutZone = (address: string) => address.replace(/%.*$/, "");
const familyOf = (address: string): 4 | 6 => (isIPv4(address) ? 4 : 6);

function ipv4Bytes(address: string): number[] {
  return address.split(".").map(Number);
}

function refusedIpv4(address: string): string | null {
  if (METADATA_V4.has(address)) return "the metadata endpoint";
  const [a = 0, b = 0, c = 0] = ipv4Bytes(address);
  if (a === 0) return "an unspecified address";
  if (a === 127) return "a loopback address";
  // 100.64/10 is carrier-grade NAT's: shared, never a public CA's.
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return "a private address";
  if (a === 169 && b === 254) return "a link-local address";
  // 192.0.0/24 (IETF protocol assignments), 198.18/15 (benchmarking), 224/4 multicast, 240/4 reserved and the broadcast address.
  if ((a === 192 && b === 0 && c === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224) return "a multicast or reserved address";
  return null;
}

/** The eight 16-bit groups of an IPv6 address (`isIP` 6), a trailing dotted IPv4 part read as two. */
function ipv6Groups(address: string): number[] {
  let text = withoutZone(address.toLowerCase());
  const tail: number[] = [];
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const [a = 0, b = 0, c = 0, d = 0] = ipv4Bytes(dotted[1]!);
    tail.push((a << 8) | b, (c << 8) | d);
    text = text.slice(0, -dotted[1]!.length);
    if (text.endsWith(":") && !text.endsWith("::")) text = text.slice(0, -1);
  }
  const groups = (part: string) => (part === "" ? [] : part.split(":").map((g) => parseInt(g, 16)));
  const [head = "", rest] = text.split("::");
  const before = groups(head);
  const after = rest === undefined ? [] : groups(rest);
  const zeros = rest === undefined ? 0 : 8 - before.length - after.length - tail.length;
  return [...before, ...Array<number>(zeros).fill(0), ...after, ...tail];
}

/** fd00:ec2::254, the IPv6 instance metadata endpoint (inside fc00::/7), as its groups joined. */
const METADATA_V6 = ipv6Groups("fd00:ec2::254").join(":");

/** Groups `from` up to `to` of `g` are all zero. */
const zeros = (g: readonly number[], from: number, to: number) => g.slice(from, to).every((x) => x === 0);

/** The IPv4 address that groups `at` and `at + 1` of `g` carry. */
const ipv4At = (g: readonly number[], at: number) => [g[at]! >> 8, g[at]! & 0xff, g[at + 1]! >> 8, g[at + 1]! & 0xff].join(".");

/**
 * Where `g` carries an IPv4 address the packet reaches, the group it starts at: mapped
 * (::ffff:0:0/96), SIIT-translated (::ffff:0:0:0/96), IPv4-compatible (::/96), NAT64
 * (64:ff9b::/96) or 6to4 (2002::/16). Null for any other address.
 */
function embeddedIpv4At(g: readonly number[]): number | null {
  if (zeros(g, 0, 5) && g[5] === 0xffff) return 6;
  if (zeros(g, 0, 4) && g[4] === 0xffff && g[5] === 0) return 6;
  if (zeros(g, 0, 6)) return 6;
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(g, 2, 6)) return 6;
  if (g[0] === 0x2002) return 1;
  return null;
}

function refusedIpv6(address: string): string | null {
  const g = ipv6Groups(address);
  if (zeros(g, 0, 8)) return "an unspecified address";
  if (zeros(g, 0, 7) && g[7] === 1) return "a loopback address";
  // An IPv4 address inside is refused as that address would be: the packet reaches it.
  const at = embeddedIpv4At(g);
  if (at !== null) return refusedIpv4(ipv4At(g, at));
  const first = g[0]!;
  // Local-use NAT64 (64:ff9b:1::/48) reaches IPv4 addresses the network itself chooses.
  if (first === 0x64 && g[1] === 0xff9b && g[2] === 1) return "a private address";
  // Teredo (2001::/32) tunnels through a relay to an address it obscures.
  if (first === 0x2001 && g[1] === 0) return "a tunnel address";
  if ((first & 0xffc0) === 0xfe80) return "a link-local address";
  if (g.join(":") === METADATA_V6) return "the metadata endpoint";
  if ((first & 0xfe00) === 0xfc00) return "a unique-local address";
  // fec0::/10 is the old site-local range: private, like fc00::/7.
  if ((first & 0xffc0) === 0xfec0) return "a private address";
  if ((first & 0xff00) === 0xff00) return "a multicast or reserved address";
  return null;
}

/**
 * Why the worker never connects to `address` (an IPv4 or IPv6 address), or null when it is
 * public: unspecified, loopback, private, link-local, unique-local, multicast or reserved, a
 * tunnel, the metadata endpoint, or an IPv6 address carrying an IPv4 one that is any of these.
 */
export const refusedAddress: AddressCheck = (address) => {
  if (isIP(withoutZone(address)) === 0) return "not an IP address";
  return isIPv4(address) ? refusedIpv4(address) : refusedIpv6(address);
};

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

/** Every address `hostname` resolves to. */
export type Resolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

export interface PublicFetchOptions {
  /** The DNS lookup; the system's by default. Tests give a fake one. */
  readonly resolve?: Resolver;
  /** Why an address is refused; `refusedAddress` by default. Only a test with a loopback server gives another. */
  readonly refuse?: AddressCheck;
  /** The most an answer may be; MAX_ANSWER_BYTES by default. */
  readonly maxBytes?: number;
}

export const systemResolver: Resolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map(({ address }) => ({ address, family: familyOf(address) }));

/** The host of `url` without an IPv6 literal's brackets. */
export const hostOf = (url: URL) => url.hostname.replace(/^\[|\]$/g, "");

/**
 * Why `host` is refused before any lookup: an IP address that is refused, or a localhost name
 * (RFC 6761, never a CA's). Null for any other name: what it resolves to is checked when fetched.
 */
export function refusedHost(host: string, refuse: AddressCheck = refusedAddress): string | null {
  if (isIP(host) !== 0) {
    const why = refuse(host);
    return why ? `${host} is ${why}` : null;
  }
  return /^localhost\.?$|\.localhost\.?$/i.test(host) ? `${host} is a loopback host` : null;
}

/**
 * The addresses to connect to for `host`: itself when it is an address, else every address it
 * resolves to. Throws when any one of them is refused (`refusedAddress`), or there are none.
 */
async function checkedAddresses(host: string, resolve: Resolver, refuse: AddressCheck, signal: AbortSignal | null): Promise<readonly ResolvedAddress[]> {
  const why = refusedHost(host, refuse);
  if (why) throw new Error(`a local address: ${why}`);
  if (isIP(host) !== 0) return [{ address: host, family: familyOf(host) }];
  const addresses = await untilAborted(resolve(host), signal);
  if (addresses.length === 0) throw new Error(`${host} resolves to no address`);
  for (const { address } of addresses) {
    const refused = refuse(address);
    if (refused) throw new Error(`a local address: ${host} resolves to ${address}, ${refused}`);
  }
  return addresses;
}

/** `promise`, or the signal's reason once it ends first: a DNS answer that never comes is no longer waited for. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | null): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise<T>((settle, fail) => {
    const onAbort = () => fail(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(settle, fail).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** A DNS lookup that answers only `addresses`, the checked ones: the connection never looks the name up again. */
function connectOnlyTo(addresses: readonly ResolvedAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    const wanted = options.family === 4 || options.family === "IPv4" ? 4 : options.family === 6 || options.family === "IPv6" ? 6 : 0;
    const usable = wanted === 0 ? addresses : addresses.filter((a) => a.family === wanted);
    const first = usable[0];
    if (!first) {
      callback(Object.assign(new Error(`no checked IPv${wanted} address`), { code: "ENOTFOUND" }), "", 0);
      return;
    }
    if (options.all) callback(null, usable.map(({ address, family }) => ({ address, family })));
    else callback(null, first.address, first.family);
  };
}

function bodyBytes(body: RequestInit["body"]): Buffer | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body));
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  throw new Error("a request body must be a string or bytes");
}

/** The statuses whose Response may carry no body. */
const NULL_BODY = new Set([101, 103, 204, 205, 304]);

/**
 * A fetch for addresses a certificate names. It resolves the host first and refuses it when any
 * address it resolves to is refused (`refusedAddress`), then connects to those checked addresses
 * only, so a second DNS answer cannot move it elsewhere; the Host header and TLS server name stay
 * the URL's own. It follows no redirect (one is the answer) and reads no more than `maxBytes`.
 * Only what revocation.ts sends: GET or POST, header names and values, a string or bytes body.
 */
export function publicFetch(options: PublicFetchOptions = {}): typeof fetch {
  const resolve = options.resolve ?? systemResolver;
  const refuse = options.refuse ?? refusedAddress;
  const maxBytes = options.maxBytes ?? MAX_ANSWER_BYTES;
  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("not an http(s) address");
    const host = hostOf(url);
    const addresses = await checkedAddresses(host, resolve, refuse, init.signal ?? null);
    const body = bodyBytes(init.body);
    const headers: Record<string, string> = Object.fromEntries(new Headers(init.headers));
    if (body) headers["content-length"] = String(body.length);
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    return await new Promise<Response>((settle, fail) => {
      const req = request(
        {
          protocol: url.protocol,
          host,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: init.method ?? "GET",
          headers,
          // eslint-disable-next-line rabaed/no-avoid-terms -- node:http's own option name for the DNS step.
          lookup: connectOnlyTo(addresses),
          // The certificate is checked against the name, as for any https fetch.
          servername: url.protocol === "https:" && isIP(host) === 0 ? host : undefined,
          // A fresh connection: no pooled socket opened for another lookup.
          agent: false,
          signal: init.signal ?? undefined,
        },
        (res) => {
          const refuseAnswer = (why: string) => {
            res.destroy();
            fail(new Error(why));
          };
          const tooLarge = () => refuseAnswer(`answered more than ${maxBytes} bytes`);
          const status = res.statusCode ?? 0;
          // A Response carries 200 to 599 only; anything else is no answer, not a crash.
          if (status < 200 || status > 599) return refuseAnswer(`answered ${status}`);
          if (Number(res.headers["content-length"] ?? 0) > maxBytes) return tooLarge();
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) tooLarge();
            else chunks.push(chunk);
          });
          res.on("error", fail);
          res.on("end", () => {
            // Inside a listener a throw would end the worker, not the fetch.
            try {
              const answerHeaders = new Headers();
              for (const [name, value] of Object.entries(res.headers)) {
                for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) answerHeaders.append(name, one);
              }
              settle(new Response(NULL_BODY.has(status) ? null : Buffer.concat(chunks), { status, headers: answerHeaders }));
            } catch (error) {
              fail(error);
            }
          });
        },
      );
      req.on("error", fail);
      req.end(body);
    });
  }) as typeof fetch;
}
