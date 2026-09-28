import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { storyText } from "../storybook/locale.ts";
import { palette } from "./palette.ts";
import { radii, shadows, typeScale } from "./scales.ts";
import { coolLight, reviewCodes, stageKeys, type SemanticRole } from "./themes.ts";

const meta = {
  title: "Foundations/Tokens",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const roles = Object.keys(coolLight) as SemanticRole[];
const groups: { en: string; ar: string; roles: SemanticRole[] }[] = [
  { en: "Surfaces and lines", ar: "الأسطح والحدود", roles: ["canvas", "surface", "surface-subtle", "hover", "press", "border", "border-subtle", "border-strong", "control-border", "control-border-hover"] },
  { en: "Text", ar: "النص", roles: ["text", "text-secondary", "muted", "faint"] },
  { en: "Brand", ar: "الهوية", roles: ["brand", "brand-ink", "brand-tint"] },
  { en: "Actions", ar: "الإجراءات", roles: roles.filter((r) => /^(primary|secondary|ghost|danger|on-|disabled|focus)/.test(r)) },
  { en: "Feedback", ar: "الحالة", roles: ["success", "success-tint", "danger-tint"] },
  { en: "Step Age", ar: "عمر الخطوة", roles: roles.filter((r) => r.startsWith("age-")) },
];

function Heading({ children }: { children: string }) {
  return <h2 className="mb-3 font-display text-h6 font-semibold text-text">{children}</h2>;
}

function Swatch({ role }: { role: SemanticRole }) {
  return (
    <li className="flex items-center gap-3">
      <span aria-hidden="true" className="size-10 shrink-0 rounded-sm border border-border" style={{ background: `var(--${role})` }} />
      <span className="min-w-0">
        <span className="block font-mono text-caption text-text">{role}</span>
        <span className="block font-mono text-notes text-muted" dir="ltr">
          {coolLight[role]} · {palette[coolLight[role]]}
        </span>
      </span>
    </li>
  );
}

function Pair({ bg, fg, label }: { bg: SemanticRole; fg: SemanticRole; label: string }) {
  return (
    <span
      className="inline-flex h-6 items-center rounded-xs px-2 text-caption font-medium"
      style={{ background: `var(--${bg})`, color: `var(--${fg})` }}
    >
      {label}
    </span>
  );
}

function TokenSpecimen(context: StoryContext) {
  const t = (en: string, ar: string) => storyText(context, { en, ar });
  return (
    <main className="space-y-8 bg-canvas p-6">
      <h1 className="font-display text-h4 font-bold text-text">{t("Rabaed tokens · cool light", "رموز ربائد · الفاتح البارد")}</h1>

      {groups.map((group) => (
        <section key={group.en} className="rounded-md border border-border bg-surface p-4 shadow-xs">
          <Heading>{t(group.en, group.ar)}</Heading>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
            {group.roles.map((role) => (
              <Swatch key={role} role={role} />
            ))}
          </ul>
        </section>
      ))}

      <section className="rounded-md border border-border bg-surface p-4 shadow-xs">
        <Heading>{t("Stage", "المرحلة")}</Heading>
        <div className="flex flex-wrap gap-2">
          {stageKeys.map((stage) => (
            <Pair key={stage} bg={`stage-${stage}-bg`} fg={`stage-${stage}-fg`} label={`stage-${stage}`} />
          ))}
        </div>
      </section>

      <section className="rounded-md border border-border bg-surface p-4 shadow-xs">
        <Heading>{t("Review Code", "رمز المراجعة")}</Heading>
        <div className="flex flex-wrap gap-2">
          {reviewCodes.map((code) => (
            <Pair key={code} bg={`code-${code}-bg`} fg={`code-${code}-fg`} label={code.toUpperCase()} />
          ))}
        </div>
      </section>

      <section className="rounded-md border border-border bg-surface p-4 shadow-xs">
        <Heading>{t("Type scale", "مقاسات الخط")}</Heading>
        <ul className="space-y-2">
          {Object.entries(typeScale).map(([name, [size]]) => (
            <li key={name} className="flex items-baseline gap-4">
              <span className="w-32 shrink-0 font-mono text-caption text-muted">
                {name} · {size}
              </span>
              <span className="text-text" style={{ fontSize: `var(--text-${name})`, lineHeight: `var(--text-${name}--line-height)` }}>
                {t("Riyadh Gate Tower", "برج بوابة الرياض")} 0123
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-md border border-border bg-surface p-4 shadow-xs">
        <Heading>{t("Radii and shadows", "الزوايا والظلال")}</Heading>
        <div className="flex flex-wrap gap-4">
          {Object.entries(radii).map(([name, value]) => (
            <div key={name} className="flex size-20 items-end border border-border-strong bg-surface-subtle p-1" style={{ borderRadius: value }}>
              <span className="font-mono text-notes text-muted">{`radius-${name}`}</span>
            </div>
          ))}
          {Object.keys(shadows).map((name) => (
            <div key={name} className="flex size-20 items-end rounded-md bg-surface p-1" style={{ boxShadow: `var(--shadow-${name})` }}>
              <span className="font-mono text-notes text-muted">{`shadow-${name}`}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

export const Specimen: Story = {
  render: (_args, context) => <TokenSpecimen {...context} />,
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole("heading", { level: 2 })).toHaveLength(groups.length + 4);
    for (const role of ["canvas", "primary", "focus", "age-4"]) await expect(canvas.getByText(role)).toBeVisible();
    // Latin digits in both languages.
    await expect(canvas.getAllByText(/0123/).length).toBe(Object.keys(typeScale).length);
  },
};
