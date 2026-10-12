"use client";

import { useDirection } from "@radix-ui/react-direction";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { physicalSide } from "../../lib/direction.ts";
import { focusRing, touchArea } from "../form/control-styles.ts";
import { Icon, type IconName } from "../icon/icon.tsx";

export type ToastTone = "info" | "success" | "danger";

export type ToastInput = { title: ReactNode; description?: ReactNode; tone?: ToastTone };

type ShowToast = (toast: ToastInput) => void;

const ToastContext = createContext<ShowToast | null>(null);

let nextToastId = 0;

const icons: Record<ToastTone, IconName> = { info: "info-circle", success: "circle-check", danger: "alert-circle" };
const iconColour: Record<ToastTone, string> = { info: "text-muted", success: "text-success", danger: "text-danger-fg" };
/** On the dark pill: light tints that keep 3:1. */
const darkIconColour: Record<ToastTone, string> = { info: "text-on-primary", success: "text-success-tint", danger: "text-danger-tint" };

export type ToastProviderProps = {
  /** Names the notifications region for screen readers, e.g. "Notifications" / "الإشعارات". */
  label: string;
  /** The dismiss button's accessible name, e.g. "Dismiss" / "إغلاق". */
  closeLabel: string;
  /** How long a toast stays, in ms. */
  duration?: number;
  /** Where toasts sit: the bottom inline-end corner (default), or the bottom centre, clear of side panels. */
  placement?: "end" | "center";
  /** `dark`: a dark pill with light text (the Workflow builder's, as its reference), in every theme. */
  look?: "default" | "dark";
  children: ReactNode;
};

/**
 * Hosts toasts: wrap the app once, then call `useToast()` anywhere below.
 * Toasts appear at the bottom inline-end corner and are announced to screen
 * readers: politely, or at once for `tone: "danger"`.
 */
export function ToastProvider({ label, closeLabel, duration = 5000, placement = "end", look = "default", children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<(ToastInput & { id: number })[]>([]);
  const show = useCallback<ShowToast>((toast) => setToasts((list) => [...list, { ...toast, id: nextToastId++ }]), []);
  // Swiped away towards the inline-end corner they sit in.
  const swipeDirection = physicalSide("end", useDirection());

  return (
    <ToastContext.Provider value={show}>
      <ToastPrimitive.Provider label={label} duration={duration} swipeDirection={swipeDirection}>
        {children}
        {toasts.map(({ id, title, description, tone = "info" }) => (
          <ToastPrimitive.Root
            key={id}
            // Radix announces "foreground" toasts assertively and "background" ones politely.
            type={tone === "danger" ? "foreground" : "background"}
            onOpenChange={(open) => {
              if (!open) setToasts((list) => list.filter((toast) => toast.id !== id));
            }}
            className={cn(
              "flex items-start gap-3 p-4 shadow-lg",
              look === "dark" ? "rounded-md bg-sidebar px-4 py-3 text-on-primary" : "rounded-sm border border-border bg-surface text-text",
            )}
          >
            <Icon name={icons[tone]} className={cn("mt-0.5", look === "dark" ? darkIconColour[tone] : iconColour[tone])} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <ToastPrimitive.Title className="text-body font-semibold">{title}</ToastPrimitive.Title>
              {description && <ToastPrimitive.Description className={cn("text-sm", look === "dark" ? "text-on-primary [&_a]:text-on-primary" : "text-muted")}>{description}</ToastPrimitive.Description>}
            </div>
            <ToastPrimitive.Close
              aria-label={closeLabel}
              // 24px to look at; a 44px hit area on touch screens.
              className={cn("-m-1 rounded-xs p-1", look === "dark" ? "text-on-primary hover:opacity-80" : "text-muted hover:bg-hover hover:text-text", focusRing, touchArea)}
            >
              <Icon name="x" size={16} />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        {/* Above dialogs (z-50), so feedback from inside a dialog is visible. */}
        <ToastPrimitive.Viewport
          className={cn("fixed bottom-0 z-[60] flex w-full max-w-sm flex-col gap-2 p-4 outline-none", placement === "center" ? "inset-x-0 mx-auto" : "end-0")}
        />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

/** Shows a toast: `const toast = useToast(); toast({ title, description, tone })`. Needs a ToastProvider above. */
export function useToast(): ShowToast {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast needs a <ToastProvider> above it.");
  return show;
}
