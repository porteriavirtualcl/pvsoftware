import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

/* ─────────────────────────────────────────────────────────────
   Button
   ──────────────────────────────────────────────────────────── */
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:   'bg-blue-600 text-white hover:bg-blue-700 shadow-sm shadow-blue-600/20 active:translate-y-px',
  secondary: 'bg-slate-100 text-slate-900 border border-slate-200 hover:bg-slate-200 dark:bg-white/5 dark:text-slate-100 dark:border-white/10 dark:hover:bg-white/10',
  ghost:     'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5',
  danger:    'bg-red-600 text-white hover:bg-red-700 shadow-sm shadow-red-600/20',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs gap-1.5 rounded-lg',
  md: 'px-4 py-2.5 text-sm gap-2 rounded-xl',
  lg: 'px-5 py-3 text-[15px] gap-2 rounded-xl',
};

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  fullWidth?: boolean;
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon: Icon,
  iconRight: IconRight,
  fullWidth = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-semibold cursor-pointer select-none',
        'transition-[background,color,box-shadow,transform] duration-150',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
    >
      {loading ? (
        <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden />
      ) : Icon ? (
        <Icon size={size === 'sm' ? 14 : 16} strokeWidth={2.2} aria-hidden />
      ) : null}
      <span>{children}</span>
      {IconRight && !loading && <IconRight size={size === 'sm' ? 14 : 16} strokeWidth={2.2} aria-hidden />}
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────
   Card
   ──────────────────────────────────────────────────────────── */
type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: 'solid' | 'glass';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hoverable?: boolean;
};

const CARD_PADDING = { none: '', sm: 'p-4', md: 'p-5', lg: 'p-7' } as const;

export function Card({
  variant = 'solid',
  padding = 'md',
  hoverable = false,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      {...rest}
      className={cn(
        variant === 'glass' ? 'card-glass' : 'card',
        CARD_PADDING[padding],
        hoverable && 'transition-shadow duration-200 hover:shadow-lg hover:shadow-slate-900/5 dark:hover:shadow-black/40',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   PageHeader
   ──────────────────────────────────────────────────────────── */
type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  className?: string;
};

export function PageHeader({ eyebrow, title, description, icon: Icon, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6', className)}>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
        <div className="flex items-center gap-3">
          {Icon && (
            <div className="w-10 h-10 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <Icon size={20} strokeWidth={2.2} />
            </div>
          )}
          <h1 className="truncate">{title}</h1>
        </div>
        {description && (
          <p className="subtle mt-2 max-w-2xl">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}

/* ─────────────────────────────────────────────────────────────
   Field (label + input wrapper)
   ──────────────────────────────────────────────────────────── */
type FieldProps = {
  label?: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  className?: string;
};

export function Field({ label, hint, error, children, htmlFor, required, className }: FieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="block text-xs font-semibold text-slate-600 dark:text-slate-400">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p>
      ) : hint ? (
        <p className="text-xs text-slate-500 dark:text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };
export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, invalid, ...rest }, ref) => (
  <input
    ref={ref}
    {...rest}
    aria-invalid={invalid || undefined}
    className={cn(
      'block w-full bg-white dark:bg-slate-950/50',
      'border border-slate-200 dark:border-white/10',
      'rounded-xl px-3.5 py-2.5 text-[15px]',
      'text-slate-900 dark:text-slate-100',
      'placeholder:text-slate-400 dark:placeholder:text-slate-600',
      'outline-none transition',
      'focus:border-blue-600 dark:focus:border-blue-500',
      'focus:ring-2 focus:ring-blue-500/20',
      invalid && 'border-red-500 focus:border-red-600 focus:ring-red-500/20',
      className,
    )}
  />
));
Input.displayName = 'Input';

/* ─────────────────────────────────────────────────────────────
   Modal
   ──────────────────────────────────────────────────────────── */
type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  icon?: LucideIcon;
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
  footer?: React.ReactNode;
};

const MODAL_SIZES = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl' } as const;

export function Modal({ open, onClose, title, description, icon: Icon, size = 'sm', children, footer }: ModalProps) {
  // Lock body scroll while modal is open
  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/50 dark:bg-black/80 backdrop-blur-sm"
          />
          <motion.div
            initial={{ y: 20, opacity: 0, scale: 0.98 }}
            animate={{ y: 0,  opacity: 1, scale: 1 }}
            exit={{    y: 20, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
            className={cn(
              'relative w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10',
              'rounded-2xl shadow-2xl overflow-hidden',
              MODAL_SIZES[size],
            )}
          >
            {(title || Icon) && (
              <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
                <div className="flex items-start gap-3 min-w-0">
                  {Icon && (
                    <div className="w-10 h-10 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                      <Icon size={18} strokeWidth={2.2} />
                    </div>
                  )}
                  <div className="min-w-0">
                    {title && <h2 className="truncate">{title}</h2>}
                    {description && <p className="subtle mt-0.5">{description}</p>}
                  </div>
                </div>
                <button
                  onClick={onClose}
                  aria-label="Cerrar"
                  className="p-1.5 -mr-1.5 -mt-1 text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
            )}
            <div className="px-6 pb-6">{children}</div>
            {footer && (
              <div className="px-6 py-4 bg-slate-50 dark:bg-white/[0.02] border-t border-slate-200 dark:border-white/5 flex items-center justify-end gap-2">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/* ─────────────────────────────────────────────────────────────
   StatCard
   ──────────────────────────────────────────────────────────── */
type StatAccent = 'brand' | 'indigo' | 'purple' | 'success' | 'warn' | 'danger';
type StatCardProps = React.HTMLAttributes<HTMLDivElement> & {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  trend?: { value: string; direction: 'up' | 'down' | 'flat' };
  accent?: StatAccent;
  loading?: boolean;
  compact?: boolean;
};

const STAT_ACCENT: Record<StatAccent, string> = {
  brand:   'bg-blue-600/10 text-blue-600 dark:text-blue-400',
  indigo:  'bg-indigo-600/10 text-indigo-600 dark:text-indigo-400',
  purple:  'bg-purple-600/10 text-purple-600 dark:text-purple-400',
  success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  warn:    'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  danger:  'bg-red-500/10 text-red-600 dark:text-red-400',
};

export function StatCard({ label, value, icon: Icon, trend, accent = 'brand', loading, compact = false, className, onClick, ...rest }: StatCardProps) {
  return (
    <Card
      padding={compact ? 'none' : 'md'}
      onClick={onClick}
      className={cn(
        compact
          ? 'flex flex-col items-center text-center gap-2 py-4 px-2 transition-colors'
          : 'flex items-center gap-4 transition-colors',
        onClick && 'cursor-pointer hover:bg-slate-50/50 dark:hover:bg-white/[0.02]',
        className
      )}
      {...rest}
    >
      {Icon && (
        <div className={cn(
          compact ? 'w-9 h-9 rounded-xl' : 'w-11 h-11 rounded-xl',
          'flex items-center justify-center shrink-0 transition-transform',
          onClick && 'group-hover:scale-105',
          STAT_ACCENT[accent],
        )}>
          <Icon size={compact ? 17 : 20} strokeWidth={2.2} />
        </div>
      )}
      <div className={cn('min-w-0', compact ? 'w-full' : 'flex-1')}>
        <p className={cn('font-medium text-slate-500 dark:text-slate-400', compact ? 'text-[10px] leading-tight' : 'text-xs truncate')}>{label}</p>
        <div className={cn('flex items-baseline gap-2 mt-0.5', compact && 'justify-center')}>
          {loading ? (
            <span className={cn('inline-block rounded-md bg-slate-200 dark:bg-white/10 animate-pulse', compact ? 'h-6 w-8' : 'h-7 w-14')} />
          ) : (
            <p className={cn('font-bold tracking-tight text-slate-900 dark:text-white truncate', compact ? 'text-xl' : 'text-2xl')}>{value}</p>
          )}
          {trend && !loading && (
            <span className={cn(
              'text-xs font-semibold',
              trend.direction === 'up'   && 'text-emerald-600 dark:text-emerald-400',
              trend.direction === 'down' && 'text-red-600 dark:text-red-400',
              trend.direction === 'flat' && 'text-slate-500 dark:text-slate-400',
            )}>
              {trend.value}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────
   EmptyState
   ──────────────────────────────────────────────────────────── */
type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
};

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center py-16 px-6', className)}>
      {Icon && (
        <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-white/5 flex items-center justify-center mb-4 text-slate-400 dark:text-slate-500">
          <Icon size={24} strokeWidth={2} />
        </div>
      )}
      <h3 className="text-slate-900 dark:text-white">{title}</h3>
      {description && <p className="subtle mt-1.5 max-w-sm">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Badge
   ──────────────────────────────────────────────────────────── */
type BadgeProps = {
  variant?: 'brand' | 'success' | 'warn' | 'danger' | 'muted';
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
};

const BADGE_VARIANTS = {
  brand:   'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
  success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
  warn:    'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
  danger:  'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
  muted:   'bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-400',
} as const;

export function Badge({ variant = 'muted', icon: Icon, children, className }: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold',
      BADGE_VARIANTS[variant],
      className,
    )}>
      {Icon && <Icon size={11} strokeWidth={2.5} />}
      {children}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────
   Spinner (inline loading)
   ──────────────────────────────────────────────────────────── */
export function Spinner({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <span
      role="status"
      aria-label="Cargando"
      style={{ width: size, height: size }}
      className={cn('inline-block border-2 border-blue-600/20 border-t-blue-600 rounded-full animate-spin', className)}
    />
  );
}
