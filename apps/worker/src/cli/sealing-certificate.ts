// Makes Rabaed's own certificate for the KMS key `pdf-sealing` (ADR 0023,
// RP-620): self-signed by that key in KMS, so the private key never leaves it.
// Prints the PEM; an operator uploads it to the build assets bucket as
// `sealing/pdf-sealing.pem`, where the worker reads it at its first record.
// A certificate Adobe trusts (AATL) replaces it later without a redesign.
//
//   pnpm --filter @rabaed/worker exec tsx src/cli/sealing-certificate.ts <key ARN or alias> <region> [years]
import { GetPublicKeyCommand, KMSClient } from "@aws-sdk/client-kms";
import { asn1js, OID, pkijs, toArrayBuffer, toBytes } from "../record/pki.ts";
import { kmsSealSigner } from "../record/signer.ts";

const [keyId, region, years = "10"] = process.argv.slice(2);
if (!keyId || !region) {
  console.error("Usage: sealing-certificate.ts <key ARN or alias> <region> [years]");
  process.exit(2);
}

const client = new KMSClient({ region });
const publicKey = await client.send(new GetPublicKeyCommand({ KeyId: keyId }));
if (!publicKey.PublicKey) throw new Error("KMS returned no public key");

const certificate = new pkijs.Certificate();
certificate.version = 2;
const certificateNumber = crypto.getRandomValues(new Uint8Array(16));
certificateNumber[0]! &= 0x7f;
certificate.serialNumber = new asn1js.Integer({ valueHex: toArrayBuffer(certificateNumber) });
const name = [
  new pkijs.AttributeTypeAndValue({ type: OID.organization, value: new asn1js.Utf8String({ value: "Rabaed" }) }),
  new pkijs.AttributeTypeAndValue({ type: OID.commonName, value: new asn1js.Utf8String({ value: "Rabaed Documental Records" }) }),
];
certificate.issuer.typesAndValues.push(...name);
certificate.subject.typesAndValues.push(...name);
const now = new Date();
certificate.notBefore.value = now;
certificate.notAfter.value = new Date(Date.UTC(now.getUTCFullYear() + Number(years), now.getUTCMonth(), now.getUTCDate()));
certificate.subjectPublicKeyInfo = pkijs.PublicKeyInfo.fromBER(toArrayBuffer(publicKey.PublicKey));
certificate.extensions = [
  new pkijs.Extension({ extnID: OID.basicConstraints, critical: true, extnValue: new pkijs.BasicConstraints({ cA: false }).toSchema().toBER(false) }),
  // digitalSignature and nonRepudiation.
  new pkijs.Extension({ extnID: OID.keyUsage, critical: true, extnValue: new asn1js.BitString({ valueHex: new Uint8Array([0xc0]).buffer, unusedBits: 6 }).toBER(false) }),
];
const algorithm = () => new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256WithRsa, algorithmParams: new asn1js.Null() });
certificate.signature = algorithm();
certificate.signatureAlgorithm = algorithm();
const tbs = toBytes(certificate.encodeTBS().toBER(false));
const signature = await kmsSealSigner({ keyId, region, certificates: [] }, client).sign(tbs);
certificate.signatureValue = new asn1js.BitString({ valueHex: toArrayBuffer(signature) });

const der = Buffer.from(certificate.toSchema(true).toBER(false));
const body = der.toString("base64").match(/.{1,64}/g)!.join("\n");
console.log(`-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----`);
