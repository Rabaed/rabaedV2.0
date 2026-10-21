"use client";

import { moduleTabPaths, type DimensionValues, type DocumentSummary, type Locale, type WorkItemActions, type WorkItemDetail } from "@rabaed/domain";
import {
  SnagCameraStep,
  SnagFlowBack,
  SnagFlowButton,
  SnagFlowFrame,
  SnagFlowLink,
  SnagLocationStep,
  SnagRaiseStep,
  SnagSubjectStep,
  type FlowPhoto,
  type SnagFlowLabels,
  type SubjectAnswers,
} from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { TransitionPopup } from "@/components/transition-opening";
import { uploadToWorkItem, useImageUrls } from "@/components/use-documents";
import { Link, useRouter } from "@/i18n/navigation";
import { useCreateRefusal } from "@/lib/create-refusal";
import { isLastLevel, locationChoices, locationPath, phoneSteps, withLocation, type PhoneStep } from "@/lib/snag-phone-flow";

type Draft = {
  id: string;
  subject: string;
  answers: Record<string, unknown>;
  trade: WorkItemDetail["trade"];
  photos: DocumentSummary[];
  /** The Raise offered to the viewer on it now; null when none is (no Contractor covers it, say). */
  raise: WorkItemActions["transitions"][number] | null;
  saveAnswers: boolean;
};

function useFlowLabels(): SnagFlowLabels {
  const t = useTranslations("snagList.mobile.flow");
  return {
    newSnag: t("newSnag"),
    stepOf: (n, of) => t("stepOf", { n, of }),
    back: t("back"),
    cancel: t("cancel"),
    draftSaved: t("draftSaved"),
    saving: t("saving"),
    next: t("next"),
    camera: { takePhoto: t("camera.takePhoto"), library: t("camera.library"), skip: t("camera.skip"), pointAt: t("camera.pointAt"), remove: (name) => t("camera.remove", { name }) },
    subject: { heading: t("subject.heading"), subject: t("subject.subject"), placeholder: t("subject.placeholder"), description: t("subject.description"), trade: t("subject.trade") },
    location: { heading: t("location.heading"), allZones: t("location.allZones"), hint: t("location.hint") },
    raise: { heading: t("raise.heading"), raise: t("raise.raise"), notOffered: t("raise.notOffered"), openDraft: t("raise.openDraft") },
  };
}

/**
 * The camera-first New Snag on a phone (RP-630): the camera and the Subject live in the page until
 * the Draft is created at the Subject step (its Subject can't change after), with its Description and
 * Trade, and the photos are uploaded to it; the Location is saved to the Draft as soon as it is picked.
 * The URL then holds the Draft and the step. Raise is the Draft's own, offered only when the API offers
 * it; where two Contractors cover the Snag, its pop-up asks which one holds it (RP-658).
 */
export function SnagPhoneNew({
  projectId,
  typeCode,
  locale,
  step: initial,
  photosField,
  askDescription,
  trades,
  locations,
  draft,
  photosMissing = false,
}: {
  projectId: string;
  typeCode: string;
  locale: Locale;
  step: PhoneStep;
  photosField: string;
  askDescription: boolean;
  trades: DimensionValues["trade"];
  locations: DimensionValues["location"];
  draft: Draft | null;
  /** Some photos taken before the Draft could not be added to it. */
  photosMissing?: boolean;
}) {
  const labels = useFlowLabels();
  const t = useTranslations("snagList.mobile.flow");
  const w = useTranslations("workItems");
  const router = useRouter();
  const listHref = `/projects/${projectId}/${moduleTabPaths.snag_list}`;
  const refusal = useCreateRefusal();
  const stepHref = (id: string, step: PhoneStep) => `${listHref}/new?type=${encodeURIComponent(typeCode)}&draft=${id}&step=${step}`;
  const [step, setStep] = useState<PhoneStep>(initial);
  const number = phoneSteps.indexOf(step) + 1;

  // Before the Draft: the photos taken, shown from the phone itself.
  const [taken, setTaken] = useState<{ id: string; file: File; url: string }[]>([]);
  const shown = useRef(new Set<string>());
  // The phone's own copies are let go when the page goes.
  useEffect(() => {
    const urls = shown.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);
  const takenPhotos: FlowPhoto[] = taken.map((p) => ({ id: p.id, url: p.url, name: p.file.name }));

  const [answers, setAnswers] = useState<SubjectAnswers>({ subject: "", description: "", trade: trades.length === 1 ? trades[0]!.id : null });
  const [errors, setErrors] = useState<Partial<Record<"subject" | "description" | "trade", string>>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const draftUrls = useImageUrls(draft?.id ?? "", draft ? draft.photos : []);
  const draftPhotos: FlowPhoto[] = (draft?.photos ?? []).map((d) => ({ id: d.id, url: draftUrls[d.id] ?? null, name: d.fileName }));

  /** The Subject step's Next: the Draft, then its photos, then its Location step. */
  async function createDraft() {
    const missing = {
      ...(answers.subject.trim() ? {} : { subject: t("errors.subject") }),
      ...(askDescription && !answers.description.trim() ? { description: t("errors.description") } : {}),
      ...(answers.trade ? {} : { trade: t("errors.trade") }),
    };
    setErrors(missing);
    if (Object.keys(missing).length > 0) return;
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/work-items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: typeCode, title: answers.subject.trim(), answers: { trade: answers.trade, ...(askDescription ? { description: answers.description.trim() } : {}) } }),
      });
      if (res.status !== 201) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage(refusal(body.error));
        return;
      }
      const { id } = (await res.json()) as { id: string };
      let failed = 0;
      for (const photo of taken) if (!(await uploadToWorkItem(id, photo.file, { fieldKey: photosField })).ok) failed++;
      router.replace(`${stepHref(id, "location")}${failed > 0 ? "&missing=1" : ""}`);
    } catch {
      setMessage(w("unavailable"));
    } finally {
      setPending(false);
    }
  }

  // The Location step: saved to the Draft as soon as it is picked.
  const [picked, setPicked] = useState<string | undefined>(typeof draft?.answers.location === "string" ? draft.answers.location : undefined);
  const [saved, setSaved] = useState<"saved" | "saving">("saved");
  // Picks follow one another, each saved after the one before, so the Draft ends with the last.
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const lastPick = useRef(0);
  function pick(id: string | null) {
    setPicked(id ?? undefined);
    if (!draft || id === null) return;
    const mine = ++lastPick.current;
    setSaved("saving");
    setMessage(null);
    saving.current = saving.current.then(async () => {
      const res = await fetch(`/api/v1/work-items/${draft.id}/answers`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers: withLocation(draft.answers, id) }),
      }).catch(() => null);
      if (!res?.ok) setMessage(t("errors.notSaved"));
      if (mine === lastPick.current) setSaved("saved");
    });
  }

  const [raising, setRaising] = useState(false);
  const back = (href: string) => <SnagFlowBack label={labels.back} href={href} linkAs={Link} />;
  const alert = message && (
    <p role="alert" className="text-sm text-danger-fg">
      {message}
    </p>
  );

  if (step === "photo") {
    return (
      <SnagCameraStep
        photos={takenPhotos}
        labels={labels}
        cancelHref={listHref}
        linkAs={Link}
        onAdd={(files) => {
          const added = files.map((file) => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) }));
          added.forEach((p) => shown.current.add(p.url));
          setTaken((all) => [...all, ...added]);
        }}
        onRemove={(id) => {
          const gone = taken.find((p) => p.id === id);
          if (gone) {
            URL.revokeObjectURL(gone.url);
            shown.current.delete(gone.url);
          }
          setTaken((all) => all.filter((p) => p.id !== id));
        }}
        onNext={() => setStep("subject")}
      />
    );
  }

  if (step === "subject") {
    return (
      <SnagFlowFrame
        heading={labels.subject.heading}
        step={number}
        steps={phoneSteps.length}
        labels={labels}
        back={<SnagFlowBack label={labels.back} onClick={() => setStep("photo")} />}
        footer={
          <SnagFlowButton onClick={() => void createDraft()} disabled={pending}>
            {labels.next}
          </SnagFlowButton>
        }
      >
        <SnagSubjectStep photos={takenPhotos} value={answers} onChange={setAnswers} trades={trades} askDescription={askDescription} errors={errors} locale={locale} labels={labels} />
        {alert}
      </SnagFlowFrame>
    );
  }

  if (!draft) return null;
  const path = locationPath(locations, picked);
  const place = path.length > 0 ? path.slice(-2).map((p) => p.name[locale]).join(" · ") : null;

  if (step === "location") {
    return (
      <SnagFlowFrame
        heading={labels.location.heading}
        step={number}
        steps={phoneSteps.length}
        labels={labels}
        saved={saved}
        // The Draft is kept: back to the List, where it is among the viewer's Drafts.
        back={back(listHref)}
        footer={
          // Down to the last level (a Floor): a place with nothing inside it.
          <SnagFlowButton onClick={() => router.push(stepHref(draft.id, "raise"))} disabled={!isLastLevel(locations, picked) || saved === "saving"}>
            {labels.next}
          </SnagFlowButton>
        }
      >
        {photosMissing && (
          <p role="note" className="rounded-md border border-border bg-surface-subtle p-3 text-sm text-text-secondary">
            {t("errors.photosMissing")}
          </p>
        )}
        <SnagLocationStep path={path} choices={locationChoices(locations, picked ?? null)} picked={picked} onPick={pick} locale={locale} labels={labels} />
        {alert}
      </SnagFlowFrame>
    );
  }

  return (
    <SnagFlowFrame
      heading={labels.raise.heading}
      step={number}
      steps={phoneSteps.length}
      labels={labels}
      saved="saved"
      back={back(stepHref(draft.id, "location"))}
      footer={
        draft.raise ? (
          <SnagFlowButton onClick={() => setRaising(true)}>{draft.raise.label[locale]}</SnagFlowButton>
        ) : (
          <SnagFlowLink href={`/work-items/${draft.id}`} linkAs={Link} variant="secondary">
            {labels.raise.openDraft}
          </SnagFlowLink>
        )
      }
    >
      <SnagRaiseStep photo={draftPhotos[0]} subject={draft.subject} place={place} trade={draft.trade.name[locale]} offered={draft.raise !== null} labels={labels} />
      {/* Raised, the page reads the item again and opens its own page. */}
      {raising && draft.raise && (
        <TransitionPopup workItemId={draft.id} subject={draft.subject} transition={draft.raise} locale={locale} idPrefix="phone-raise" onClose={() => setRaising(false)} />
      )}
    </SnagFlowFrame>
  );
}
