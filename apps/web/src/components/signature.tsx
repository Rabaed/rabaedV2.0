"use client";

import type { MySignature, SaveSignatureRequest } from "@rabaed/domain";
import { buttonVariants, SignatureEditor, SignatureRequiredDialog, type SaveSignatureCall, type SignatureEditorLabels } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import type { Reading } from "@/lib/transition-gate";
import { useApiRead } from "@/lib/use-api-read";

// The Signature (RP-85, ADR 0023): Profile → Add Signature, and the pop-up that sends a Member
// without one there from a Transition, and back.

function useEditorLabels(): SignatureEditorLabels {
  const t = useTranslations("signature");
  return {
    methods: t("methods"),
    drawn: t("drawn"),
    typed: t("typed"),
    uploaded: t("uploaded"),
    pad: t("pad"),
    pen: t("pen"),
    pens: { fine: t("pens.fine"), medium: t("pens.medium"), bold: t("pens.bold") },
    ink: t("ink"),
    inks: { black: t("inks.black"), blue: t("inks.blue") },
    clear: t("clear"),
    name: t("name"),
    hand: t("hand"),
    hands: { flowing: t("hands.flowing"), upright: t("hands.upright") },
    preview: t("preview"),
    file: t("file"),
    chooseFile: t("chooseFile"),
    fileHelp: t("fileHelp"),
    save: t("save"),
    empty: t("empty"),
    refusals: {
      invalid_signature_image: t("refusals.invalid_signature_image"),
      file_type: t("refusals.file_type"),
      file_too_large: t("refusals.file_too_large"),
      unavailable: t("refusals.unavailable"),
    },
  };
}

/**
 * Add Signature: the editor, saved through the API (PUT /v1/me/signature). Saving takes the
 * Member back where they came from (`returnTo`, the item the pop-up sent them from), or to
 * their profile.
 */
export function AddSignature({ defaultName, returnTo }: { defaultName: string; returnTo: string | null }) {
  const t = useTranslations("signature");
  const router = useRouter();
  const save: SaveSignatureCall = async (signature: SaveSignatureRequest) => {
    const res = await fetch("/api/v1/me/signature", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signature),
    });
    if (!res.ok) {
      const { error } = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, reason: error ?? "unavailable" };
    }
    router.push(returnTo ?? "/profile");
    router.refresh();
    return { ok: true };
  };
  return (
    <SignatureEditor
      labels={useEditorLabels()}
      defaultName={defaultName}
      onSave={save}
      secondaryAction={
        <Link href={returnTo ?? "/profile"} className={buttonVariants({ variant: "ghost" })}>
          {t("back")}
        </Link>
      }
    />
  );
}

/** The signed-in Member's own Signature, read when `enabled`: loading until answered, or failed. */
export function useMySignatureRead(enabled: boolean): Reading<MySignature> {
  return useApiRead<MySignature>("/v1/me/signature", enabled);
}

/**
 * The pop-up a Member without a Signature gets when they open a Transition, before its Action
 * Form: Add Signature, then back to `returnTo` (the page they are on).
 */
export function SignatureRequired({ open, onOpenChange, returnTo }: { open: boolean; onOpenChange: (open: boolean) => void; returnTo: string }) {
  const t = useTranslations("signature");
  return (
    <SignatureRequiredDialog
      open={open}
      onOpenChange={onOpenChange}
      labels={{ title: t("required.title"), body: t("required.body"), notNow: t("required.notNow"), close: t("required.close") }}
      addSignature={
        <Link href={{ pathname: "/profile/signature", query: { returnTo } }} className={buttonVariants()}>
          {t("add")}
        </Link>
      }
    />
  );
}
