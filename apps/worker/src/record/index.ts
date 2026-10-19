// The Documental Record maker (ADR 0023), for the worker and for the tests that
// run its job in-process and check what it made (apps/api/test).
export { checkRecord, expectationOf, imageCountOf, pageCountOf, recordProblems, type RecordExpectation } from "./checks.ts";
export { parseRecordData } from "./record-data-read.ts";
export { replacedRecordKey, reproduceHandler } from "./reproduce.ts";
export { isPinnedImage, parseVeraPdfReport, PINNED_VERAPDF_IMAGE, veraPdfCli, veraPdfDocker, veraPdfDockerSession, veraPdfFromEnv, type PdfAValidation, type PdfAValidator, type PdfAValidatorSession } from "./verapdf.ts";
export { documentalRecordHandler, verificationCode, type RecordJobDeps } from "./job.ts";
export { filesUnder, projectFilesFromEnv, recordKeys, s3Client, s3RecordFiles, type RecordFiles, type S3Settings } from "./files.ts";
export { recordJobFromEnv, SEALING_CERTIFICATE_KEY, THMANYAH_PREFIX } from "./from-env.ts";
export { fallbackFonts, thmanyahFonts, type RecordFonts } from "./fonts.ts";
export { recordHtml } from "./layout.ts";
export { renderRecord } from "./pages.ts";
export { pdfImages, type PdfImage } from "./pdf-images.ts";
export { attachedFiles, pdfA3Problems, toPdfA3, type AttachedFile } from "./pdfa.ts";
export { LAYOUT_VERSION, NO_IMAGES, RECORD_DATA_NAMESPACE, recordDataOf, recordDataXml, recordOf, recordPath, type RecordData, type RecordImages } from "./record-data.ts";
export { chromiumRenderer, type PdfRenderer } from "./render.ts";
export { sealPdf, sealTamperOffsets, verifySeal, withByteChanged, type SealCheck } from "./seal.ts";
export { kmsSealSigner, LOCAL_SEAL_NAME, localSealSigner, type SealSigner } from "./signer.ts";
export { LOCAL_TSA_NAME, localTimestampAuthority, rfc3161TimestampAuthority, type TimestampAuthority } from "./timestamp.ts";
