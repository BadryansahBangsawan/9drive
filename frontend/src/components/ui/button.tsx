import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-fg hover:opacity-90',
        secondary: 'border border-border bg-bg text-text hover:bg-hover',
        ghost: 'text-muted hover:bg-hover hover:text-text',
        danger: 'bg-danger text-primary-fg hover:opacity-90',
        dangerOutline: 'border border-danger bg-bg text-danger hover:bg-hover',
        // Aliases kept so pages not yet rebuilt keep compiling.
        default: 'bg-primary text-primary-fg hover:opacity-90',
        outline: 'border border-border bg-bg text-text hover:bg-hover',
        soft: 'border border-border bg-bg text-text hover:bg-hover',
      },
      size: {
        sm: 'h-7 px-2.5',
        md: 'h-8 px-3',
        lg: 'h-9 px-4',
        icon: 'h-8 w-8 p-0',
        default: 'h-8 px-3',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
