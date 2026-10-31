// Makes the UAT sealing authority (RP-1042, ADR 0026): a self-signed test authority whose key and
// certificate the UAT Records container's host holds as two secrets, UAT_SEALING_AUTHORITY_KEY and
// UAT_SEALING_AUTHORITY_CERTIFICATE. Run once by the owner; writes `uat-sealing-authority.key.pem`
// and `uat-sealing-authority.certificate.pem` into a folder outside the repo (the repo is public),
// never over an existing file, and prints nothing secret. Set them as host secrets, then delete the key file.
//
//   pnpm --filter @rabaed/worker exec tsx src/cli/uat-sealing-authority.ts <folder outside the repo>
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pemToDer } from "../record/pki.ts";
import { newUatAuthority } from "../record/uat-signer.ts";
import { authorityFolderProblem, repoRootOf } from "./uat-authority-folder.ts";

const [folderArg] = process.argv.slice(2);
if (!folderArg) {
  console.error("Usage: uat-sealing-authority.ts <folder outside the repo>");
  process.exit(2);
}
const folder = resolve(folderArg);
const problem = authorityFolderProblem(folder, repoRootOf(process.cwd()));
if (problem) {
  console.error(problem);
  process.exit(1);
}
const keyFile = join(folder, "uat-sealing-authority.key.pem");
const certificateFile = join(folder, "uat-sealing-authority.certificate.pem");
for (const file of [keyFile, certificateFile]) {
  if (existsSync(file)) {
    console.error(`${file} already exists: nothing written. Move it away first, or choose another folder.`);
    process.exit(1);
  }
}

const authority = await newUatAuthority();
mkdirSync(folder, { recursive: true });
writeFileSync(keyFile, authority.key, { mode: 0o600 });
writeFileSync(certificateFile, authority.certificate);
const fingerprint = createHash("sha256").update(pemToDer(authority.certificate)).digest("hex");
console.log(`Wrote ${keyFile}`);
console.log(`Wrote ${certificateFile}`);
console.log(`Certificate SHA-256: ${fingerprint}`);
console.log("Set them as the host's secrets UAT_SEALING_AUTHORITY_KEY and UAT_SEALING_AUTHORITY_CERTIFICATE, then delete the key file.");
