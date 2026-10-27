"use client";

import { useTranslations } from "next-intl";
import Image from "next/image";
import { useEffect, useState, type CSSProperties } from "react";
import { Icon, cn, type IconName } from "@rabaed/ui";
import { brandStep, type BrandRole } from "@/lib/sign-in-brand";

// Where each Project Role sits in the diagram, in % of its box: across from the reading start, and down.
// Logical insets, so Arabic mirrors it (the Contractor at the reading start in both).
const roles: Record<BrandRole, { icon: IconName; across: number; down: number }> = {
  owner: { icon: "building-skyscraper", across: 50, down: 22 },
  contractor: { icon: "crane", across: 18, down: 80 },
  consultant: { icon: "ruler", across: 82, down: 80 },
};

const at = (across: number, down: number): CSSProperties => ({ insetInlineStart: `${across}%`, top: `${down}%` });
// Centre an absolutely placed item on its point, whichever side the inset is measured from.
const centred = "absolute -translate-y-1/2 -translate-x-1/2 rtl:translate-x-1/2";

const tint = (percent: number) => `color-mix(in srgb, var(--brand) ${percent}%, transparent)`;
// The tomato glow in the top corner away from the form, and a fainter one opposite (the design's ::before).
const glow = (side: "start" | "end") => {
  const [near, far] = side === "end" ? ["100%", "0%"] : ["0%", "100%"];
  return `radial-gradient(70% 60% at ${near} 0%, ${tint(28)}, transparent 70%), radial-gradient(50% 50% at ${far} 100%, ${tint(8)}, transparent 70%)`;
};

/**
 * The dark brand panel beside the sign-in form (owner's design, RP-1057): a document passing from the
 * Contractor to the Consultant to the Owner, and the headline. Hidden on narrow screens; still under
 * reduced motion. An illustration, not data.
 */
export function SignInShowcase() {
  const t = useTranslations("signIn.brand");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setTick((n) => n + 1), 2400);
    return () => window.clearInterval(timer);
  }, []);
  const step = brandStep(tick);
  const holder = roles[step.role];

  return (
    <aside
      aria-labelledby="sign-in-brand-headline"
      className="relative m-4 hidden flex-col gap-2 overflow-hidden rounded-xl bg-hero px-11 pt-9 pb-11 text-hero-text min-[961px]:flex"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 rtl:hidden" style={{ background: glow("end") }} />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 ltr:hidden" style={{ background: glow("start") }} />

      <div className="relative flex items-center gap-3.5">
        <Image src="/brand/rabaed-logo-on-dark.svg" alt="" width={102} height={34} unoptimized className="h-8.5 w-auto" />
        <span className="ms-auto text-end font-mono text-[11.5px] tracking-[0.1em] text-brand rtl:font-ui rtl:text-[12.5px] rtl:tracking-normal">
          {t("tagline")}
        </span>
      </div>

      <div aria-hidden="true" className="relative mx-auto mt-auto aspect-[600/360] w-full max-w-130 [@media(max-height:760px)]:max-w-100">
        <svg viewBox="0 0 600 360" fill="none" className="absolute inset-0 size-full stroke-hero-text/20">
          <g strokeWidth="1.6" strokeDasharray="7 7" strokeLinecap="round">
            <line x1="210" y1="290" x2="390" y2="290" />
            <line x1="430" y1="240" x2="330" y2="120" />
            <line x1="270" y1="120" x2="170" y2="240" />
          </g>
        </svg>
        {(Object.keys(roles) as BrandRole[]).map((role) => {
          const { icon, across, down } = roles[role];
          const lit = role === step.role;
          return (
            <div key={role} className={cn(centred, "flex flex-col items-center gap-2.5")} style={at(across, down)}>
              <span
                className={cn(
                  "flex size-21 items-center justify-center rounded-[22px] border transition-all duration-400",
                  lit
                    ? "border-brand bg-brand/10 text-brand shadow-[0_0_0_8px_color-mix(in_srgb,var(--brand)_8%,transparent),0_0_40px_color-mix(in_srgb,var(--brand)_25%,transparent)]"
                    : "border-hero-text/10 bg-hero-text/4 text-hero-text",
                )}
              >
                <Icon name={icon} size={38} />
              </span>
              <span className={cn("text-sm font-medium transition-colors duration-400", lit ? "text-hero-text" : "text-hero-muted")}>{t(role)}</span>
            </div>
          );
        })}
        <span
          className={cn(
            centred,
            "z-10 -mt-14.5 flex h-10 w-8.5 items-center justify-center rounded-[7px] bg-brand text-on-primary",
            "shadow-[0_0_0_6px_var(--hero),0_6px_20px_color-mix(in_srgb,var(--brand)_50%,transparent)]",
            "transition-[inset-inline-start,top] duration-900 ease-[cubic-bezier(.6,0,.3,1)]",
          )}
          style={at(holder.across, holder.down)}
        >
          <Icon name="file-text" size={19} />
        </span>
      </div>

      <div
        aria-hidden="true"
        className="relative mt-4.5 mb-auto inline-flex h-8.5 items-center gap-2.5 self-center rounded-full border border-hero-text/8 bg-hero-text/5 px-4 text-sm whitespace-nowrap"
      >
        <span className="size-1.75 rounded-full bg-brand" />
        <span className="font-medium tabular-nums">{t(step.status, { time: step.time })}</span>
      </div>

      <div className="relative flex flex-col gap-3.5">
        <h2
          id="sign-in-brand-headline"
          className="font-display text-h2 leading-[1.15] font-bold tracking-[-0.02em] text-hero-text rtl:leading-[1.35] rtl:tracking-normal [@media(max-height:760px)]:text-h3"
        >
          {t("headlineCompanies")}
          <br />
          {t("headlineRecord")}
          <br />
          <em className="text-brand not-italic">{t("headlineAccountability")}</em>
        </h2>
        <p className="max-w-125 text-[15.5px] leading-[1.6] text-pretty text-hero-muted">{t("lead")}</p>
      </div>
    </aside>
  );
}
