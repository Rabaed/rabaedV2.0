import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { focusRing } from "../form/control-styles.ts";

export const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm font-medium select-none",
    "transition-colors duration-150",
    focusRing,
    "disabled:cursor-not-allowed disabled:bg-disabled disabled:text-on-disabled",
    "aria-disabled:cursor-not-allowed aria-disabled:bg-disabled aria-disabled:text-on-disabled",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    // Touch targets of at least 44px on phones (gloved hands on site).
    "pointer-coarse:min-h-11",
  ],
  {
    variants: {
      variant: {
        primary: "bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-press",
        secondary: "bg-secondary text-on-secondary hover:bg-secondary-hover active:bg-secondary-press",
        ghost: "bg-transparent text-on-ghost hover:bg-ghost-hover active:bg-ghost-press",
        danger: "bg-danger text-on-danger hover:bg-danger-hover active:bg-danger-press",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        md: "h-9 px-4 text-body",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type ButtonVariantProps = VariantProps<typeof buttonVariants>;

export type ButtonProps = ComponentProps<"button"> & ButtonVariantProps;

/** For links styled as buttons, use `buttonVariants()` on the link instead. */
export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return (
    <button
      // A plain <button> defaults to "submit"; default to "button" so it never submits a form by accident.
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export type IconButtonProps = Omit<ButtonProps, "children" | "aria-label"> & {
  /** The accessible name. Icon-only buttons have no visible text, so this is required. */
  label: string;
  /** The icon, marked decorative by the button. */
  children: ReactNode;
};

/** A square, icon-only button. `label` becomes its accessible name and tooltip text. */
export function IconButton({ label, variant = "ghost", size, className, children, ...props }: IconButtonProps) {
  return (
    <Button
      aria-label={label}
      title={label}
      variant={variant}
      size={size}
      className={cn("px-0", size === "sm" ? "w-8" : "w-9", "pointer-coarse:min-w-11", className)}
      {...props}
    >
      <span aria-hidden="true" className="contents">
        {children}
      </span>
    </Button>
  );
}
