import { argon2, randomBytes, timingSafeEqual } from "node:crypto";

// OWASP's argon2id baseline: 19 MiB memory, 2 passes, 1 lane.
const params = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 };

function derive(password: string, salt: Buffer, p: typeof params): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    argon2("argon2id", { message: password, nonce: salt, ...p }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}

const b64 = (b: Buffer) => b.toString("base64").replace(/=+$/, "");

/** Returns a PHC string: $argon2id$v=19$m=…,t=…,p=…$salt$hash. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, params);
  return `$argon2id$v=19$m=${params.memory},t=${params.passes},p=${params.parallelism}$${b64(salt)}$${b64(hash)}`;
}

const phc = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const m = phc.exec(stored);
  if (!m) return false;
  const [, memory, passes, parallelism, salt, hash] = m;
  const expected = Buffer.from(hash!, "base64");
  const actual = await derive(password, Buffer.from(salt!, "base64"), {
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
    tagLength: expected.length,
  });
  return timingSafeEqual(actual, expected);
}

// Verified against when the email is unknown, so a wrong email costs the same
// time as a wrong password (no discovery of registered emails through timing).
// Computed once at startup (buildApp awaits it), so no request pays for it.
let dummy: Promise<string> | undefined;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(32).toString("hex"));
  return dummy;
}
