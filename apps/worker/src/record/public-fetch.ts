import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, isIPv4, type LookupFunction } from "node:net";

// The fetch for addresses a certificate names (RP-1085): the CRL, OCSP and
// caIssuers addresses of the sealing and timestamp chains (revocation.ts). A
// CA's address is outside Rabaed's control, so the worker reaches public
// addresses only: never the task's metadata endpoint, the VPC or itself.

/** 169.254.169.254 (EC2 and ECS instance metadata) and 169.254.170.2 (ECS task metadata and credentials). */
const METADATA_V4 = new Set(["169.254.169.254", "169.254.170.2"]);
/** fd00:ec2::254, the IPv6 instance metadata endpoint, as its eight groups. */
const METADATA_V6 = [0xfd00, 0xec2, 0, 0, 0, 0, 0, 0x254].join(":");

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
  let text = address.toLowerCase().replace(/%.*$/, "");
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

const ipv4Of = (high: number, low: number) => [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");

function refusedIpv6(address: string): string | null {
  const g = ipv6Groups(address);
  const zeroUpTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeroUpTo(8)) return "an unspecified address";
  if (zeroUpTo(7) && g[7] === 1) return "a loopback address";
  // An IPv4 address inside: mapped (::ffff:0:0/96), IPv4-compatible (::/96), NAT64 (64:ff9b::/96) or 6to4 (2002::/16).
  // Each reaches the IPv4 address it carries, so it is refused as that address would be.
  if (zeroUpTo(5) && g[5] === 0xffff) return refusedIpv4(ipv4Of(g[6]!, g[7]!));
  if (zeroUpTo(6)) return refusedIpv4(ipv4Of(g[6]!, g[7]!));
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return refusedIpv4(ipv4Of(g[6]!, g[7]!));
  if (g[0] === 0x2002) return refusedIpv4(ipv4Of(g[1]!, g[2]!));
  const first = g[0]!;
  if ((first & 0xffc0) === 0xfe80) return "a link-local address";
  // fd00:ec2::254 is the IPv6 instance metadata endpoint, inside fc00::/7.
  if (g.join(":") === METADATA_V6) return "the metadata endpoint";
  if ((first & 0xfe00) === 0xfc00) return "a unique-local address";
  // fec0::/10 is the old site-local range: private, like fc00::/7.
  if ((first & 0xffc0) === 0xfec0) return "a private address";
  if ((first & 0xff00) === 0xff00) return "a multicast or reserved address";
  return null;
}

/**
 * Why the worker never connects to `address` (an IPv4 or IPv6 address), or null when it is
 * public: unspecified, loopback, private, link-local, unique-local, multicast or reserved, the
 * metadata endpoint, or an IPv6 address carrying an IPv4 one that is any of these.
 */
export function refusedAddress(address: string): string | null {
  const family = isIP(address.replace(/%.*$/, ""));
  if (family === 0) return "not an IP address";
  return isIPv4(address) ? refusedIpv4(address) : refusedIpv6(address);
}

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
  readonly refuse?: (address: string) => string | null;
  /** The most an answer may be; 20 MB by default. */
  readonly maxBytes?: number;
}

export const systemResolver: Resolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map(({ address, family }) => ({ address, family: family === 6 ? 6 : 4 }));

/** The host of `url` without an IPv6 literal's brackets. */
export const hostOf = (url: URL) => url.hostname.replace(/^\[|\]$/g, "");

/**
 * Why `host` is refused before any lookup: an IP address that is refused, or a localhost name
 * (RFC 6761, never a CA's). Null for any other name: what it resolves to is checked when fetched.
 */
export function refusedHost(host: string, refuse: (address: string) => string | null = refusedAddress): string | null {
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
async function checkedAddresses(host: string, resolve: Resolver, refuse: (address: string) => string | null): Promise<readonly ResolvedAddress[]> {
  const why = refusedHost(host, refuse);
  if (why) throw new Error(`a local address: ${why}`);
  const family = isIP(host);
  if (family !== 0) return [{ address: host, family: family === 6 ? 6 : 4 }];
  const addresses = await resolve(host);
  if (addresses.length === 0) throw new Error(`${host} resolves to no address`);
  for (const { address } of addresses) {
    const refused = refuse(address);
    if (refused) throw new Error(`a local address: ${host} resolves to ${address}, ${refused}`);
  }
  return addresses;
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
  const maxBytes = options.maxBytes ?? 20 * 1024 * 1024;
  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("not an http(s) address");
    const host = hostOf(url);
    const addresses = await checkedAddresses(host, resolve, refuse);
    init.signal?.throwIfAborted();
    const body = bodyBytes(init.body);
    const headers: Record<string, string> = Object.fromEntries(new Headers(init.headers));
    if (body) headers["content-length"] = String(body.length);
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    return await new Promise<Response>((answer, fail) => {
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
          const tooLarge = () => {
            res.destroy();
            fail(new Error(`answered more than ${maxBytes} bytes`));
          };
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
            const status = res.statusCode ?? 0;
            const answerHeaders = new Headers();
            for (const [name, value] of Object.entries(res.headers)) {
              for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) answerHeaders.append(name, one);
            }
            answer(new Response(NULL_BODY.has(status) ? null : Buffer.concat(chunks), { status, headers: answerHeaders }));
          });
        },
      );
      req.on("error", fail);
      req.end(body);
    });
  }) as typeof fetch;
}
