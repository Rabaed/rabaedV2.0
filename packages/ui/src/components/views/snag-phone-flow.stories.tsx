import type { Locale } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { storyLocale } from "../../storybook/locale.ts";
import {
  SnagCameraStep,
  SnagFlowBack,
  SnagFlowButton,
  SnagFlowFrame,
  SnagLocationStep,
  SnagRaiseStep,
  SnagSubjectStep,
  type FlowPhoto,
  type SnagFlowLabels,
  type SubjectAnswers,
} from "./snag-phone-flow.tsx";

// The camera-first New Snag on a phone (RP-630; design/reference/claude-design/ui_kits/app/snag-list-mobile.html),
// a step a story. Story data only.
const b = (en: string, ar: string) => ({ en, ar });

const labels: Record<Locale, SnagFlowLabels> = {
  en: {
    newSnag: "New Snag",
    stepOf: (n, of) => `Step ${n} of ${of}`,
    back: "Back",
    cancel: "Cancel",
    draftSaved: "Draft saved",
    saving: "Saving…",
    next: "Next",
    camera: { takePhoto: "Take a photo", library: "Library", skip: "Skip", pointAt: "Point the camera at the snag", remove: (name) => `Remove ${name}` },
    subject: { heading: "What's wrong?", subject: "Subject", placeholder: "e.g. Cable tray not bonded", description: "Description", trade: "Trade" },
    location: { heading: "Where is it?", allZones: "All Zones", hint: "Pick the Zone, then the Building and the Floor. It is saved to the Draft as you pick." },
    raise: { heading: "Ready to raise", raise: "Raise", notOffered: "Raise isn't offered to you on this Draft now. It is saved: open it to see it.", openDraft: "Open the Draft" },
  },
  ar: {
    newSnag: "عيب جديد",
    stepOf: (n, of) => `الخطوة ${n} من ${of}`,
    back: "رجوع",
    cancel: "إلغاء",
    draftSaved: "تم حفظ المسودة",
    saving: "جارٍ الحفظ…",
    next: "التالي",
    camera: { takePhoto: "التقاط صورة", library: "المعرض", skip: "تخطي", pointAt: "وجّه الكاميرا نحو العيب", remove: (name) => `إزالة ${name}` },
    subject: { heading: "ما الخلل؟", subject: "الموضوع", placeholder: "مثال: حامل الكابلات غير موصول بالأرضي", description: "الوصف", trade: "التخصص" },
    location: { heading: "أين هو؟", allZones: "كل المناطق", hint: "اختر المنطقة ثم المبنى ثم الطابق. يُحفظ في المسودة عند اختياره." },
    raise: { heading: "جاهز للإصدار", raise: "إصدار", notOffered: "الإصدار غير متاح لك على هذه المسودة الآن. وهي محفوظة: افتحها لتراها.", openDraft: "فتح المسودة" },
  },
};

// A photo drawn here, so the story loads nothing from elsewhere.
const picture = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3" fill="currentColor" opacity=".35"/><rect y="2" width="4" height="1" fill="currentColor" opacity=".55"/></svg>')}`;
const photos: FlowPhoto[] = [
  { id: "p1", url: picture, name: "riser-tray.jpg" },
  { id: "p2", url: picture, name: "riser-joint.jpg" },
];
const electrical = { id: "t-el", code: "EL", name: b("Electrical Works", "الأعمال الكهربائية") };
const mechanical = { id: "t-me", code: "ME", name: b("Mechanical Works", "الأعمال الميكانيكية") };
const zone = { id: "z", name: b("Main Zone", "المنطقة الرئيسية") };
const tower1 = { id: "t1", name: b("Tower 1", "البرج 1") };
const tower2 = { id: "t2", name: b("Tower 2", "البرج 2") };

// What the steps were asked to do, for the play functions to read.
const onNext = fn();
const onRemove = fn<(id: string) => void>();
const onPick = fn<(id: string | null) => void>();

const phone = { phone: true };
const meta = { title: "Views/SnagPhoneFlow", parameters: phone } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** Step 1: the camera. Its shutter opens the phone's camera, the library its photos; Skip while there is none. */
export const Camera: Story = {
  render: (_args, context) => <SnagCameraStep photos={[]} labels={labels[storyLocale(context)]} cancelHref="#list" onAdd={fn()} onRemove={fn()} onNext={onNext} />,
  play: async (context) => {
    const text = labels[storyLocale(context)];
    await expect(context.canvas.getByText(text.camera.pointAt)).toBeVisible();
    await expect(context.canvas.getByRole("button", { name: text.camera.takePhoto })).toBeVisible();
    await expect(context.canvas.getByRole("link", { name: text.cancel })).toHaveAttribute("href", "#list");
    await userEvent.click(context.canvas.getByRole("button", { name: text.camera.skip }));
    await expect(onNext).toHaveBeenCalled();
  },
};

/** Two photos taken: the last one in the viewfinder, each removable, and Next. */
export const CameraWithPhotos: Story = {
  render: (_args, context) => <SnagCameraStep photos={photos} labels={labels[storyLocale(context)]} cancelHref="#list" onAdd={fn()} onRemove={onRemove} onNext={fn()} />,
  play: async (context) => {
    const text = labels[storyLocale(context)];
    await userEvent.click(context.canvas.getByRole("button", { name: text.camera.remove("riser-tray.jpg") }));
    await expect(onRemove).toHaveBeenLastCalledWith("p1");
    await expect(context.canvas.getByRole("button", { name: text.next })).toBeVisible();
  },
};

function SubjectStory({ locale, errors = {} }: { locale: Locale; errors?: Partial<Record<"subject" | "description" | "trade", string>> }) {
  const [value, setValue] = useState<SubjectAnswers>({ subject: "", description: "", trade: null });
  const text = labels[locale];
  return (
    <SnagFlowFrame
      heading={text.subject.heading}
      step={2}
      steps={4}
      labels={text}
      back={<SnagFlowBack label={text.back} onClick={fn()} />}
      footer={<SnagFlowButton onClick={fn()}>{text.next}</SnagFlowButton>}
    >
      <SnagSubjectStep photos={photos} value={value} onChange={setValue} trades={[electrical, mechanical]} askDescription errors={errors} locale={locale} labels={text} />
    </SnagFlowFrame>
  );
}

/** Step 2: what is wrong. The Subject, the Description and the Trade, before the Draft exists (no "Draft saved" yet). */
export const Subject: Story = {
  render: (_args, context) => <SubjectStory locale={storyLocale(context)} />,
  play: async (context) => {
    const text = labels[storyLocale(context)];
    await expect(context.canvas.queryByText(text.draftSaved)).toBeNull();
    await expect(context.canvas.getByText(text.stepOf("2", "4"))).toBeInTheDocument();
    const trade = context.canvas.getByRole("radio", { name: mechanical.name[storyLocale(context)] });
    await userEvent.click(trade);
    await expect(trade).toHaveAttribute("aria-checked", "true");
  },
};

/** What the Subject step says when Next finds the Subject, Description or Trade missing. */
export const SubjectMissing: Story = {
  render: (_args, context) => (
    <SubjectStory
      locale={storyLocale(context)}
      errors={storyLocale(context) === "ar" ? { subject: "اكتب الموضوع.", description: "صف العيب.", trade: "اختر التخصص." } : { subject: "Write the Subject.", description: "Describe the snag.", trade: "Pick the Trade." }}
    />
  ),
  play: async (context) => {
    const text = labels[storyLocale(context)];
    await expect(context.canvas.getByRole("textbox", { name: new RegExp(text.subject.subject) })).toHaveAttribute("aria-invalid", "true");
    await expect(context.canvas.getByRole("radiogroup", { name: text.subject.trade })).toHaveAttribute("aria-invalid", "true");
  },
};

/** Step 3: where it is. The path picked so far (Main Zone), the Buildings inside it, and "Draft saved": the Draft exists now. */
export const Location: Story = {
  render: (_args, context) => {
    const text = labels[storyLocale(context)];
    return (
      <SnagFlowFrame
        heading={text.location.heading}
        step={3}
        steps={4}
        labels={text}
        saved="saved"
        back={<SnagFlowBack label={text.back} href="#list" />}
        footer={<SnagFlowButton onClick={fn()}>{text.next}</SnagFlowButton>}
      >
        <SnagLocationStep path={[zone]} choices={[tower1, tower2]} picked="z" onPick={onPick} locale={storyLocale(context)} labels={text} />
      </SnagFlowFrame>
    );
  },
  play: async (context) => {
    const text = labels[storyLocale(context)];
    await expect(context.canvas.getByText(text.draftSaved)).toBeVisible();
    await userEvent.click(context.canvas.getByRole("button", { name: tower2.name[storyLocale(context)] }));
    await expect(onPick).toHaveBeenLastCalledWith("t2");
    await userEvent.click(context.canvas.getByRole("button", { name: text.location.allZones }));
    await expect(onPick).toHaveBeenLastCalledWith(null);
    await expect(within(context.canvas.getByRole("navigation", { name: text.location.heading })).getByRole("button", { current: "location" })).toHaveTextContent(zone.name[storyLocale(context)]);
  },
};

function RaiseStory({ locale, offered }: { locale: Locale; offered: boolean }) {
  const text = labels[locale];
  return (
    <SnagFlowFrame
      heading={text.raise.heading}
      step={4}
      steps={4}
      labels={text}
      saved="saved"
      back={<SnagFlowBack label={text.back} href="#location" />}
      footer={offered ? <SnagFlowButton onClick={fn()}>{text.raise.raise}</SnagFlowButton> : <SnagFlowButton variant="secondary" onClick={fn()}>{text.raise.openDraft}</SnagFlowButton>}
    >
      <SnagRaiseStep photo={photos[0]} subject="Cable tray not bonded" place={locale === "ar" ? "البرج 2 · الطابق 01" : "Tower 2 · Floor 01"} trade={electrical.name[locale]} offered={offered} labels={text} />
    </SnagFlowFrame>
  );
}

/** Step 4: the Draft as it will be raised, and Raise. */
export const Raise: Story = {
  render: (_args, context) => <RaiseStory locale={storyLocale(context)} offered />,
  play: async (context) => {
    const text = labels[storyLocale(context)];
    await expect(context.canvas.getByRole("button", { name: text.raise.raise })).toBeVisible();
    await expect(context.canvas.queryByRole("note")).toBeNull();
  },
};

/** Raise not offered (two Contractors cover it, until the pick of RP-658): it says so, and offers the Draft instead. */
export const RaiseNotOffered: Story = {
  render: (_args, context) => <RaiseStory locale={storyLocale(context)} offered={false} />,
  play: async (context) => {
    const text = labels[storyLocale(context)];
    await expect(context.canvas.getByRole("note")).toHaveTextContent(text.raise.notOffered);
    await expect(context.canvas.queryByRole("button", { name: text.raise.raise })).toBeNull();
  },
};
