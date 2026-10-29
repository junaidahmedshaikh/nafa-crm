import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  {
    variants: {
      variant: {
        primary: "bg-nav text-nav-foreground hover:bg-nav-active",
        accent: "bg-accent text-accent-foreground hover:brightness-95",
        secondary: "border border-border-strong bg-surface text-foreground hover:bg-surface-muted",
        ghost: "text-foreground hover:bg-black/5",
        danger: "bg-danger text-white hover:brightness-95",
        "danger-outline": "border border-danger/40 bg-surface text-danger hover:bg-danger-soft",
      },
      size: { sm: "h-8 px-3", md: "h-9 px-4", icon: "h-8 w-8" },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { loading?: boolean };

export function Button({ className, variant, size, loading, disabled, children, type = "button", ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...props}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function LinkButton({
  className, variant, size, href, ...props
}: Omit<React.ComponentProps<typeof Link>, "href"> & VariantProps<typeof buttonVariants> & { href: string }) {
  return <Link href={href} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
