import { describe, expect, it } from "vitest";
import { connectWithRetry, rotatingPassword } from "./rotating-password.ts";

// A secret whose current value can change (as a rotation does), counting reads.
function secret(initial: string) {
  const state = { value: initial, reads: 0 };
  return { state, fetch: async () => (state.reads++, state.value) };
}

describe("a rotating password", () => {
  it("reads the secret once, then serves it from memory", async () => {
    const { state, fetch } = secret("one");
    const password = rotatingPassword(fetch, { now: () => 0 });
    expect(await password.get()).toBe("one");
    expect(await password.get()).toBe("one");
    expect(state.reads).toBe(1);
  });

  it("reads the secret again once the cached value is older than the TTL", async () => {
    const { state, fetch } = secret("one");
    let now = 0;
    const password = rotatingPassword(fetch, { ttlMs: 60_000, now: () => now });
    await password.get();
    state.value = "two";
    now = 59_999;
    expect(await password.get()).toBe("one");
    now = 60_000;
    expect(await password.get()).toBe("two");
  });

  it("reads the secret again after being told the password was refused", async () => {
    const { state, fetch } = secret("one");
    const password = rotatingPassword(fetch, { now: () => 0 });
    await password.get();
    state.value = "two";
    password.invalidate();
    expect(await password.get()).toBe("two");
  });

  it("shares one read among concurrent callers", async () => {
    const { state, fetch } = secret("one");
    const password = rotatingPassword(fetch, { now: () => 0 });
    expect(await Promise.all([password.get(), password.get(), password.get()])).toEqual(["one", "one", "one"]);
    expect(state.reads).toBe(1);
  });

  it("does not keep a failed read", async () => {
    let fail = true;
    const password = rotatingPassword(async () => {
      if (fail) throw new Error("throttled");
      return "one";
    });
    await expect(password.get()).rejects.toThrow("throttled");
    fail = false;
    expect(await password.get()).toBe("one");
  });
});

// Postgres's "invalid password" error code.
const refused = Object.assign(new Error("password authentication failed"), { code: "28P01" });

describe("connecting while a password rotates", () => {
  it("retries once with a fresh password when the old one is refused", async () => {
    const attempts: string[] = [];
    let invalidated = 0;
    const connection = await connectWithRetry(
      async () => {
        attempts.push("connect");
        if (attempts.length === 1) throw refused;
        return "client";
      },
      () => invalidated++,
    );
    expect(connection).toBe("client");
    expect(attempts).toHaveLength(2);
    expect(invalidated).toBe(1);
  });

  it("gives up after the retry", async () => {
    await expect(connectWithRetry(async () => Promise.reject(refused), () => undefined)).rejects.toThrow("password authentication failed");
  });

  it("does not retry other errors", async () => {
    let attempts = 0;
    const unreachable = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    await expect(connectWithRetry(async () => (attempts++, Promise.reject(unreachable)), () => undefined)).rejects.toThrow("ECONNREFUSED");
    expect(attempts).toBe(1);
  });
});
