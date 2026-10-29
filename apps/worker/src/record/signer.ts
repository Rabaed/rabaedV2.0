import { KMSClient, SignCommand } from "@aws-sdk/client-kms";
import { localCertificateAuthority } from "./local-ca.ts";
import { subtle, toArrayBuffer, toBytes } from "./pki.ts";
import { publicFetch } from "./public-fetch.ts";
import { fetchRevocationData, type RevocationData } from "./revocation.ts";

// The sealing signer (ADR 0023), one of the seal's two adapters: in AWS the KMS
// key `pdf-sealing` under Rabaed's own certificate; locally and in tests a key
// made in memory, issued by an in-memory test authority (local-ca.ts), marked
// as a test key. Either signs with RSA PKCS #1 v1.5 over SHA-256, and fetches
// the revocation data for its chain that makes the seal B-LT (RP-669).

export interface SealSigner {
  /** The certificate the seal is made under (DER), then any issuers up to the root. */
  readonly certificates: readonly Uint8Array[];
  /** Signs `message` (the CMS signed attributes): RSA PKCS #1 v1.5 over its SHA-256. */
  sign(message: Uint8Array): Promise<Uint8Array>;
  /** Revocation data for `certificates`, fetched now (revocation.ts); throws when one is revoked or has none. */
  revocation(): Promise<RevocationData>;
}

/** The common name of the local signer's certificate: never Rabaed's real one. */
export const LOCAL_SEAL_NAME = "Rabaed Documental Records (local test key, not trusted)";
/** The common name of the test authority that issues it. */
export const LOCAL_SEAL_CA_NAME = "Rabaed local sealing authority (tests only, not trusted)";

/**
 * A signer for local development and tests: a fresh in-memory key, never written anywhere,
 * issued by its own in-memory authority, whose OCSP responder answers in this process.
 */
export async function localSealSigner(): Promise<SealSigner> {
  const ca = await localCertificateAuthority(LOCAL_SEAL_CA_NAME);
  const key = await ca.issue(LOCAL_SEAL_NAME, { ocsp: true });
  const certificates = [key.certificate, ca.certificate];
  return {
    certificates,
    sign: async (message) => toBytes(await subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, toArrayBuffer(message))),
    revocation: () => fetchRevocationData(certificates, ca.fetch),
  };
}

export interface KmsSealSignerSettings {
  /** The key's alias, `alias/<prefix>-pdf-sealing` (packages/infra storage stack). */
  readonly keyId: string;
  readonly region: string;
  /** Rabaed's certificate for that key, then its issuers (DER). */
  readonly certificates: readonly Uint8Array[];
}

/**
 * The signer in AWS: KMS signs; the private key never leaves it. Its revocation data comes from
 * the addresses its certificates name, public ones only (`publicFetch`, RP-1085).
 */
export function kmsSealSigner(
  settings: KmsSealSignerSettings,
  client = new KMSClient({ region: settings.region }),
  fetchImpl: typeof fetch = publicFetch(),
): SealSigner {
  return {
    certificates: settings.certificates,
    async sign(message) {
      const signed = await client.send(
        new SignCommand({ KeyId: settings.keyId, Message: message, MessageType: "RAW", SigningAlgorithm: "RSASSA_PKCS1_V1_5_SHA_256" }),
      );
      if (!signed.Signature) throw new Error("the sealing key returned no signature");
      return signed.Signature;
    },
    revocation: () => fetchRevocationData(settings.certificates, fetchImpl),
  };
}
