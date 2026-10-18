import { KMSClient, SignCommand } from "@aws-sdk/client-kms";
import { selfSignedKey, subtle, toArrayBuffer, toBytes } from "./pki.ts";

// The sealing signer (ADR 0023), one of the seal's two adapters: in AWS the KMS
// key `pdf-sealing` under Rabaed's own certificate; locally and in tests a key
// made in memory with its own self-signed certificate, marked as a test key.
// Either signs with RSA PKCS #1 v1.5 over SHA-256.

export interface SealSigner {
  /** The certificate the seal is made under (DER), then any issuers up to the root. */
  readonly certificates: readonly Uint8Array[];
  /** Signs `message` (the CMS signed attributes): RSA PKCS #1 v1.5 over its SHA-256. */
  sign(message: Uint8Array): Promise<Uint8Array>;
}

/** The common name of the local signer's certificate: never Rabaed's real one. */
export const LOCAL_SEAL_NAME = "Rabaed Documental Records (local test key, not trusted)";

/** A signer for local development and tests: a fresh in-memory key, never written anywhere. */
export async function localSealSigner(): Promise<SealSigner> {
  const key = await selfSignedKey(LOCAL_SEAL_NAME);
  return {
    certificates: [key.certificate],
    sign: async (message) => toBytes(await subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, toArrayBuffer(message))),
  };
}

export interface KmsSealSignerSettings {
  /** The key's alias, `alias/<prefix>-pdf-sealing` (packages/infra storage stack). */
  readonly keyId: string;
  readonly region: string;
  /** Rabaed's certificate for that key, then its issuers (DER). */
  readonly certificates: readonly Uint8Array[];
}

/** The signer in AWS: KMS signs; the private key never leaves it. */
export function kmsSealSigner(settings: KmsSealSignerSettings, client = new KMSClient({ region: settings.region })): SealSigner {
  return {
    certificates: settings.certificates,
    async sign(message) {
      const signed = await client.send(
        new SignCommand({ KeyId: settings.keyId, Message: message, MessageType: "RAW", SigningAlgorithm: "RSASSA_PKCS1_V1_5_SHA_256" }),
      );
      if (!signed.Signature) throw new Error("the sealing key returned no signature");
      return signed.Signature;
    },
  };
}
