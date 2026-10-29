import { createServer, type Server, type ServerResponse } from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { createServer as createTlsServer } from "node:tls";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { publicFetch, refusedAddress, type Resolver } from "./public-fetch.ts";

// The fetch for addresses a certificate names (RP-1085): a CA's CRL, OCSP or
// caIssuers address is outside Rabaed's control, so the worker reaches only
// public addresses. No test here resolves a name or reaches the internet.

describe("which addresses are refused", () => {
  it.each([
    ["0.0.0.0", "an unspecified address"],
    ["::", "an unspecified address"],
    ["127.0.0.1", "a loopback address"],
    ["127.255.0.9", "a loopback address"],
    ["::1", "a loopback address"],
    ["10.0.0.5", "a private address"],
    ["172.16.0.1", "a private address"],
    ["172.31.255.254", "a private address"],
    ["192.168.1.1", "a private address"],
    ["100.64.0.1", "a private address"],
    ["169.254.1.1", "a link-local address"],
    ["fe80::1", "a link-local address"],
    ["fc00::1", "a unique-local address"],
    ["fd12:3456::1", "a unique-local address"],
    ["169.254.169.254", "the metadata endpoint"],
    ["169.254.170.2", "the metadata endpoint"],
    ["fd00:ec2::254", "the metadata endpoint"],
    ["224.0.0.1", "a multicast or reserved address"],
    ["255.255.255.255", "a multicast or reserved address"],
    ["ff02::1", "a multicast or reserved address"],
    // Local-use NAT64 reaches IPv4 addresses the network itself chooses.
    ["64:ff9b:1::a00:5", "a private address"],
    ["2001:0:4136:e378:8000:63bf:3fff:fdd2", "a tunnel address"],
  ])("refuses %s: %s", (address, reason) => {
    expect(refusedAddress(address)).toBe(reason);
  });

  it.each([
    ["::ffff:a9fe:a9fe", "the metadata endpoint"],
    ["::ffff:169.254.169.254", "the metadata endpoint"],
    ["::ffff:10.1.2.3", "a private address"],
    ["::ffff:127.0.0.1", "a loopback address"],
    ["::127.0.0.1", "a loopback address"],
    ["::ffff:0:a9fe:a9fe", "the metadata endpoint"],
    ["64:ff9b::a9fe:a9fe", "the metadata endpoint"],
    ["2002:c0a8:0101::1", "a private address"],
  ])("reads the IPv4 address inside an IPv6 one: %s is %s", (address, reason) => {
    expect(refusedAddress(address)).toBe(reason);
  });

  it.each(["8.8.8.8", "172.32.0.1", "172.15.255.255", "100.128.0.1", "169.255.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "64:ff9b::808:808"])(
    "lets a public address through: %s",
    (address) => {
      expect(refusedAddress(address)).toBeNull();
    },
  );

  it("refuses what is not an address at all", () => {
    expect(refusedAddress("crl.example.com")).toBe("not an IP address");
  });
});

/** A resolver that answers from `table` and counts what it is asked. */
function fakeResolver(table: Record<string, string[]>): Resolver & { asked: string[] } {
  const asked: string[] = [];
  const resolve = (async (hostname: string) => {
    asked.push(hostname);
    return (table[hostname] ?? []).map((address) => ({ address, family: address.includes(":") ? 6 : 4 }) as const);
  }) as unknown as Resolver & { asked: string[] };
  resolve.asked = asked;
  return resolve;
}

describe("fetching from an address a certificate names", () => {
  it("resolves the name first and refuses it when it resolves to a refused address", async () => {
    const resolve = fakeResolver({ "crl.example.com": ["10.0.0.5"], "ocsp.example.com": ["::ffff:a9fe:a9fe"] });
    const get = publicFetch({ resolve });
    await expect(get("http://crl.example.com/ca.crl")).rejects.toThrow("a local address: crl.example.com resolves to 10.0.0.5, a private address");
    await expect(get("http://ocsp.example.com/")).rejects.toThrow("a local address: ocsp.example.com resolves to ::ffff:a9fe:a9fe, the metadata endpoint");
    expect(resolve.asked).toEqual(["crl.example.com", "ocsp.example.com"]);
  });

  it("refuses a name when any one of its addresses is refused, even beside a public one", async () => {
    const resolve = fakeResolver({ "crl.example.com": ["8.8.8.8", "192.168.1.10"] });
    await expect(publicFetch({ resolve })("https://crl.example.com/ca.crl")).rejects.toThrow("resolves to 192.168.1.10, a private address");
  });

  it("refuses a literal address without resolving it, and a name that resolves to nothing", async () => {
    const resolve = fakeResolver({});
    const get = publicFetch({ resolve });
    await expect(get("http://[::ffff:a9fe:a9fe]/latest/meta-data")).rejects.toThrow("a local address: ::ffff:a9fe:a9fe is the metadata endpoint");
    await expect(get("http://172.20.1.1/ca.crl")).rejects.toThrow("a local address: 172.20.1.1 is a private address");
    // Decimal and hex forms are read as the dotted address they are, then refused.
    await expect(get("http://2130706433/ca.crl")).rejects.toThrow("a local address: 127.0.0.1 is a loopback address");
    await expect(get("http://0xa9.0xfe.0xa9.0xfe/")).rejects.toThrow("a local address: 169.254.169.254 is the metadata endpoint");
    expect(resolve.asked).toEqual([]);
    await expect(get("http://nowhere.example.com/ca.crl")).rejects.toThrow("nowhere.example.com resolves to no address");
  });
});

describe("connecting to the address it checked", () => {
  // A loopback server stands in for the CA. `refuse` lets loopback through here only; the
  // name ends in .test, which never resolves, so a second DNS lookup would fail the fetch.
  let server: Server;
  let port: number;
  const seen: { host?: string; method?: string; path?: string; body: string }[] = [];
  let answer: (res: ServerResponse) => void;
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString()));
      req.on("end", () => {
        seen.push({ host: req.headers.host, method: req.method, path: req.url, body });
        answer(res);
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((done) => server.close(() => done())));
  beforeEach(() => {
    seen.length = 0;
  });

  it("connects to the checked address, resolving the name once, and keeps the name as the Host", async () => {
    answer = (res) => res.writeHead(200, { "content-type": "application/ocsp-response" }).end("an answer");
    const resolve = fakeResolver({ "ocsp.ca.test": ["127.0.0.1"] });
    const get = publicFetch({ resolve, refuse: () => null });
    const res = await get(`http://ocsp.ca.test:${port}/ocsp?x=1`, {
      method: "POST",
      headers: { "content-type": "application/ocsp-request" },
      body: new TextEncoder().encode("a request").buffer,
    });
    expect({ status: res.status, type: res.headers.get("content-type"), text: await res.text() }).toEqual({
      status: 200,
      type: "application/ocsp-response",
      text: "an answer",
    });
    expect(seen).toEqual([{ host: `ocsp.ca.test:${port}`, method: "POST", path: "/ocsp?x=1", body: "a request" }]);
    expect(resolve.asked).toEqual(["ocsp.ca.test"]);
  });

  it("never follows a redirect: the redirect is the answer", async () => {
    answer = (res) => res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" }).end();
    const res = await publicFetch({ resolve: fakeResolver({ "crl.ca.test": ["127.0.0.1"] }), refuse: () => null })(`http://crl.ca.test:${port}/ca.crl`);
    expect(res.status).toBe(302);
    expect(seen).toHaveLength(1);
  });

  it("stops reading an answer larger than it takes", async () => {
    answer = (res) => res.writeHead(200).end("x".repeat(64));
    const get = publicFetch({ resolve: fakeResolver({ "crl.ca.test": ["127.0.0.1"] }), refuse: () => null, maxBytes: 16 });
    await expect(get(`http://crl.ca.test:${port}/ca.crl`)).rejects.toThrow("answered more than 16 bytes");
  });

  it("gives up when the signal ends, even while the name is still resolving", async () => {
    const never: Resolver = () => new Promise(() => {});
    await expect(publicFetch({ resolve: never })("http://crl.ca.test/ca.crl", { signal: AbortSignal.timeout(20) })).rejects.toThrow(/timed out|aborted/i);
  });
});

describe("what a CA's server may answer", () => {
  const local = { resolve: fakeResolver({ "crl.ca.test": ["127.0.0.1"] }), refuse: () => null };

  it("fails the fetch, not the worker, on a status no Response can carry", async () => {
    const odd = createNetServer((socket) => {
      socket.once("data", () => socket.end("HTTP/1.1 799 Odd\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"));
    });
    await new Promise<void>((done) => odd.listen(0, "127.0.0.1", done));
    try {
      const at = (odd.address() as AddressInfo).port;
      await expect(publicFetch(local)(`http://crl.ca.test:${at}/ca.crl`)).rejects.toThrow("answered 799");
    } finally {
      await new Promise<void>((done) => odd.close(() => done()));
    }
  });

  it("names the URL's host to TLS (SNI), not the address it connects to", async () => {
    const names: string[] = [];
    const tls = createTlsServer({
      SNICallback: (servername, done) => {
        names.push(servername);
        done(new Error("no certificate here"));
      },
    });
    await new Promise<void>((done) => tls.listen(0, "127.0.0.1", done));
    try {
      const at = (tls.address() as AddressInfo).port;
      await expect(publicFetch(local)(`https://crl.ca.test:${at}/ca.crl`)).rejects.toThrow();
      expect(names).toEqual(["crl.ca.test"]);
    } finally {
      await new Promise<void>((done) => tls.close(() => done()));
    }
  });
});
