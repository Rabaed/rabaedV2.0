import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.ts";

describe("password hashing", () => {
  it("verifies the password it hashed", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects a different password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery stable", hash)).toBe(false);
  });

  it("uses argon2id with a fresh salt each time", async () => {
    const a = await hashPassword("same password here");
    const b = await hashPassword("same password here");
    expect(a).toMatch(/^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
    expect(a).not.toBe(b);
  });

  it("treats a malformed stored hash as a mismatch", async () => {
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
    expect(await verifyPassword("anything", "$argon2id$v=19$m=x,t=2,p=1$abc$def")).toBe(false);
  });
});
