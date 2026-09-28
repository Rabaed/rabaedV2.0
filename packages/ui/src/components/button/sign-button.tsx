import { Button, type ButtonProps } from "./button.tsx";

export type SignButtonProps = Omit<ButtonProps, "variant"> & {
  variant?: "primary" | "secondary";
};

/**
 * The button for a Transition that needs the Member's signature, e.g.
 * "Acknowledge ✍". It only shows the ✍ marker; signing itself is done by the caller.
 */
export function SignButton({ children, variant = "primary", ...props }: SignButtonProps) {
  return (
    <Button variant={variant} data-signing="" {...props}>
      {children}
      <span aria-hidden="true" data-sign-marker="">
        ✍
      </span>
    </Button>
  );
}
