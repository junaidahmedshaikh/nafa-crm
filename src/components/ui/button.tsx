import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 select-none",
  {
    variants: {
      variant: {
        primary: "bg-btn-primary text-btn-primary-foreground hover:bg-btn-primary-hover shadow-xs",
        accent: "bg-accent text-accent-foreground hover:brightness-95 shadow-xs",
        secondary: "border border-btn-secondary-border bg-surface text-foreground hover:bg-secondary-accent/15 shadow-xs",
        outline: "border border-btn-secondary-border bg-transparent text-foreground hover:bg-secondary-accent/15",
        ghost: "text-foreground hover:bg-foreground/5",
        danger: "bg-danger text-danger-foreground hover:brightness-95 shadow-xs",
        "danger-outline": "border border-danger/40 bg-surface text-danger hover:bg-danger-soft",
      },
      size: { sm: "h-8 px-3 text-xs", md: "h-9 px-4", lg: "h-10 px-5 text-sm", icon: "h-8 w-8" },
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
