import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Info,
  Loader2,
  LucideIcon,
  X,
  XCircle,
} from 'lucide-react';

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/* -------------------------------------------------------------------------- */
/*                               Toast & Confirm                              */
/* -------------------------------------------------------------------------- */

type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

export interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface ToastContextVal {
  showToast: (type: ToastType, message: string) => void;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ToastContext = createContext<ToastContextVal>({ showToast: () => {} });
const ConfirmContext = createContext<ConfirmFn>(async () => false);

export const useToast = () => useContext(ToastContext);
export const useConfirm = () => useContext(ConfirmContext);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<{
    opts: ConfirmOptions;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const confirmRef = useRef<typeof confirmState>(null);
  confirmRef.current = confirmState;

  const showToast = useCallback((type: ToastType, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      if (confirmRef.current) {
        confirmRef.current.resolve(false);
      }
      setConfirmState({ opts, resolve });
    });
  }, []);

  const handleConfirmResult = useCallback((ok: boolean) => {
    setConfirmState((prev) => {
      if (prev) prev.resolve(ok);
      return null;
    });
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      <ConfirmContext.Provider value={confirm}>
        {children}

        {/* Toast Stack */}
        <div className="fixed top-5 right-5 z-50 flex flex-col gap-2 w-[360px] max-w-[calc(100vw-2.5rem)] pointer-events-none">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="animate-toast pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-lg bg-surface border border-line shadow-lg text-[13px] text-fg"
            >
              {t.type === 'success' && (
                <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
              )}
              {t.type === 'error' && (
                <XCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
              )}
              {t.type === 'info' && (
                <Info className="w-4 h-4 text-brand shrink-0 mt-0.5" />
              )}
              <span className="whitespace-pre-wrap break-words flex-1 leading-snug">
                {t.message}
              </span>
              <button
                type="button"
                onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                className="text-fg-3 hover:text-fg transition-colors cursor-pointer shrink-0 mt-0.5"
                aria-label="关闭通知"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        {/* Global Confirm Dialog */}
        <Modal
          open={!!confirmState}
          size="sm"
          title={confirmState?.opts.title || '确认操作'}
          onClose={() => handleConfirmResult(false)}
        >
          {confirmState?.opts.description && (
            <div className="text-[13px] text-fg-2 leading-relaxed">
              {confirmState.opts.description}
            </div>
          )}
          <ModalFooter className={confirmState?.opts.description ? 'mt-5' : 'mt-2'}>
            <Button variant="secondary" onClick={() => handleConfirmResult(false)}>
              {confirmState?.opts.cancelText || '取消'}
            </Button>
            <Button
              variant={confirmState?.opts.danger ? 'danger' : 'primary'}
              onClick={() => handleConfirmResult(true)}
            >
              {confirmState?.opts.confirmText || '确认'}
            </Button>
          </ModalFooter>
        </Modal>
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
};

/* -------------------------------------------------------------------------- */
/*                                   Buttons                                  */
/* -------------------------------------------------------------------------- */

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-outline';
  size?: 'sm' | 'md' | 'lg';
  icon?: LucideIcon;
  loading?: boolean;
}

const BUTTON_VARIANTS: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-brand text-white hover:bg-brand-hover shadow-xs',
  secondary:
    'bg-surface text-fg border border-line hover:bg-surface-2 hover:border-line-strong shadow-xs',
  ghost: 'text-fg-2 hover:text-fg hover:bg-surface-2',
  danger: 'bg-danger text-white hover:opacity-90',
  'danger-outline':
    'bg-surface text-danger-fg border border-line hover:border-danger/40 hover:bg-danger-soft',
};

const BUTTON_SIZES: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-8 px-3.5 text-[13px]',
  lg: 'h-10 px-4 text-sm',
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  loading = false,
  disabled,
  type = 'button',
  className,
  children,
  ...rest
}) => {
  const iconCls = size === 'lg' ? 'w-4 h-4 shrink-0' : 'w-3.5 h-3.5 shrink-0';
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 font-medium rounded-md whitespace-nowrap transition-colors duration-150 cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 className={cn(iconCls, 'animate-spin')} />
      ) : Icon ? (
        <Icon className={iconCls} />
      ) : null}
      {children}
    </button>
  );
};

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  title: string;
  tone?: 'default' | 'danger' | 'brand';
  size?: 'sm' | 'md';
}

const ICON_BUTTON_TONES: Record<NonNullable<IconButtonProps['tone']>, string> = {
  default: 'text-fg-3 hover:text-fg hover:bg-surface-2',
  danger: 'text-fg-3 hover:text-danger hover:bg-danger-soft',
  brand: 'text-fg-3 hover:text-brand hover:bg-brand-soft',
};

export const IconButton: React.FC<IconButtonProps> = ({
  icon: Icon,
  title,
  tone = 'default',
  size = 'md',
  type = 'button',
  className,
  ...rest
}) => {
  const boxCls = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8';
  const iconCls = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  return (
    <button
      type={type}
      title={title}
      aria-label={title}
      className={cn(
        'inline-flex items-center justify-center rounded-md transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
        boxCls,
        ICON_BUTTON_TONES[tone],
        className
      )}
      {...rest}
    >
      <Icon className={iconCls} />
    </button>
  );
};

/* -------------------------------------------------------------------------- */
/*                               Layout Surfaces                              */
/* -------------------------------------------------------------------------- */

export interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  extra?: React.ReactNode;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  description,
  actions,
  extra,
  className,
}) => (
  <div className={cn('flex flex-wrap items-end justify-between gap-4 mb-6', className)}>
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
        {extra}
      </div>
      {description && <p className="text-[13px] text-fg-2 mt-1">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

export interface CardProps {
  title?: string;
  description?: string;
  icon?: LucideIcon;
  extra?: React.ReactNode;
  noPadding?: boolean;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({
  title,
  description,
  icon: Icon,
  extra,
  noPadding = false,
  className,
  bodyClassName,
  children,
}) => (
  <div className={cn('bg-surface border border-line rounded-xl shadow-card', className)}>
    {title && (
      <div
        className={cn(
          'flex items-center justify-between gap-3 px-5 border-b border-line',
          description ? 'min-h-[56px] py-3' : 'h-[52px]'
        )}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {Icon && <Icon className="w-4 h-4 text-fg-3 shrink-0" />}
            <h2 className="text-sm font-semibold text-fg truncate">{title}</h2>
          </div>
          {description && <p className="text-xs text-fg-3 mt-0.5">{description}</p>}
        </div>
        {extra && <div className="flex items-center gap-2 shrink-0">{extra}</div>}
      </div>
    )}
    <div className={cn(noPadding ? '' : 'p-5', bodyClassName)}>{children}</div>
  </div>
);

/* -------------------------------------------------------------------------- */
/*                                Form Controls                               */
/* -------------------------------------------------------------------------- */

export const inputBase =
  'w-full rounded-md bg-surface border border-line text-[13px] text-fg placeholder:text-fg-3 transition-[border-color,box-shadow] hover:border-line-strong focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15 disabled:bg-surface-2 disabled:text-fg-3 disabled:cursor-not-allowed';

export const Field: React.FC<{
  label: string;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({ label, hint, required, className, children }) => (
  <div className={className}>
    <label className="block text-[13px] font-medium text-fg mb-1.5">
      {label}
      {required && <span className="text-danger ml-0.5">*</span>}
    </label>
    {children}
    {hint && <p className="text-xs text-fg-3 mt-1.5">{hint}</p>}
  </div>
);

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  mono?: boolean;
  icon?: LucideIcon;
  size?: 'sm' | 'md';
}

export const Input: React.FC<InputProps> = ({
  mono,
  icon: Icon,
  size = 'md',
  className,
  ...rest
}) => {
  const heightCls = size === 'sm' ? 'h-8' : 'h-9';
  if (Icon) {
    return (
      <div className="relative">
        <Icon className="w-4 h-4 text-fg-3 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          className={cn(inputBase, heightCls, 'pl-9 pr-3', mono && 'font-mono', className)}
          {...rest}
        />
      </div>
    );
  }
  return (
    <input
      className={cn(inputBase, heightCls, 'px-3', mono && 'font-mono', className)}
      {...rest}
    />
  );
};

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean;
}

export const Textarea: React.FC<TextareaProps> = ({ mono, className, ...rest }) => (
  <textarea
    className={cn(inputBase, 'px-3 py-2 leading-relaxed', mono && 'font-mono', className)}
    {...rest}
  />
);

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: 'sm' | 'md';
  wrapperClassName?: string;
  mono?: boolean;
}

export const Select: React.FC<SelectProps> = ({
  size = 'md',
  wrapperClassName,
  mono,
  className,
  children,
  ...rest
}) => {
  const heightCls = size === 'sm' ? 'h-8' : 'h-9';
  return (
    <div className={cn('relative', wrapperClassName || 'w-full')}>
      <select
        className={cn(
          inputBase,
          heightCls,
          'pl-3 pr-8 appearance-none cursor-pointer',
          mono && 'font-mono',
          className
        )}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown className="w-4 h-4 text-fg-3 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
    </div>
  );
};

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
}

export const Switch: React.FC<SwitchProps> = ({
  checked,
  onChange,
  disabled = false,
  label,
  description,
  className,
}) => {
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      className={cn(
        'relative inline-flex shrink-0 h-5 w-9 items-center rounded-full transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
        checked ? 'bg-brand' : 'bg-line-strong',
        Boolean(description) && 'mt-0.5',
        !label && !description && className
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        )}
      />
    </button>
  );

  if (!label && !description) return control;

  return (
    <label
      className={cn(
        'inline-flex gap-2.5 cursor-pointer select-none',
        description ? 'items-start' : 'items-center',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      {control}
      <span className="min-w-0">
        {label && <span className="block text-[13px] text-fg leading-snug">{label}</span>}
        {description && (
          <span className="block text-xs text-fg-3 mt-0.5 leading-snug">{description}</span>
        )}
      </span>
    </label>
  );
};

/* -------------------------------------------------------------------------- */
/*                                 Navigation                                 */
/* -------------------------------------------------------------------------- */

export interface TabItem {
  key: string;
  label: string;
  icon?: LucideIcon;
  count?: number;
}

export const Tabs: React.FC<{
  items: TabItem[];
  value: string;
  onChange: (key: string) => void;
  className?: string;
}> = ({ items, value, onChange, className }) => (
  <div className={cn('flex items-center gap-6 border-b border-line overflow-x-auto', className)}>
    {items.map((item) => {
      const Icon = item.icon;
      const active = value === item.key;
      return (
        <button
          key={item.key}
          type="button"
          onClick={() => onChange(item.key)}
          className={cn(
            'relative -mb-px inline-flex items-center gap-1.5 h-10 text-[13px] border-b-2 transition-colors whitespace-nowrap cursor-pointer',
            active
              ? 'border-brand text-fg font-medium'
              : 'border-transparent text-fg-2 hover:text-fg'
          )}
        >
          {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
          <span>{item.label}</span>
          {item.count !== undefined && (
            <span className="ml-0.5 px-1.5 min-w-5 h-[18px] inline-flex items-center justify-center rounded-full bg-surface-2 text-[11px] text-fg-2 tabular-nums">
              {item.count}
            </span>
          )}
        </button>
      );
    })}
  </div>
);

/* -------------------------------------------------------------------------- */
/*                                   Tables                                   */
/* -------------------------------------------------------------------------- */

export const Table: React.FC<{
  children: React.ReactNode;
  maxHeight?: string;
  className?: string;
}> = ({ children, maxHeight, className }) => (
  <div
    className={cn(maxHeight ? 'overflow-auto' : 'overflow-x-auto', className)}
    style={maxHeight ? { maxHeight } : undefined}
  >
    <table className="w-full text-[13px] text-left">{children}</table>
  </div>
);

export const THead: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <thead className="bg-surface-2 border-b border-line sticky top-0 z-[1]">{children}</thead>
);

export const Th: React.FC<{
  children: React.ReactNode;
  align?: 'left' | 'center' | 'right';
  className?: string;
}> = ({ children, align = 'left', className }) => (
  <th
    className={cn(
      'h-10 px-4 text-xs font-medium text-fg-2 whitespace-nowrap',
      align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
      className
    )}
  >
    {children}
  </th>
);

export const TBody: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <tbody className="divide-y divide-line">{children}</tbody>
);

export const Tr: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => <tr className={cn('hover:bg-surface-2/60 transition-colors', className)}>{children}</tr>;

export const Td: React.FC<{
  children: React.ReactNode;
  align?: 'left' | 'center' | 'right';
  className?: string;
}> = ({ children, align = 'left', className }) => (
  <td
    className={cn(
      'px-4 py-3 align-middle text-fg',
      align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
      className
    )}
  >
    {children}
  </td>
);

/* -------------------------------------------------------------------------- */
/*                             Badges & Feedback                              */
/* -------------------------------------------------------------------------- */

export interface BadgeProps {
  tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
  icon?: LucideIcon;
  className?: string;
  children: React.ReactNode;
}

const BADGE_TONES: Record<NonNullable<BadgeProps['tone']>, string> = {
  neutral: 'bg-surface-2 text-fg-2 border-line',
  brand: 'bg-brand-soft text-brand-fg border-brand/20',
  success: 'bg-success-soft text-success-fg border-success/20',
  warning: 'bg-warning-soft text-warning-fg border-warning/20',
  danger: 'bg-danger-soft text-danger-fg border-danger/20',
};

export const Badge: React.FC<BadgeProps> = ({
  tone = 'neutral',
  icon: Icon,
  className,
  children,
}) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 h-5 px-1.5 rounded text-[11px] font-medium border whitespace-nowrap',
      BADGE_TONES[tone],
      className
    )}
  >
    {Icon && <Icon className="w-3 h-3 shrink-0" />}
    {children}
  </span>
);

export const StatusBadge: React.FC<{
  active: boolean;
  activeText?: string;
  inactiveText?: string;
}> = ({ active, activeText = '运行中', inactiveText = '已停止' }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1.5 h-[22px] px-2 rounded-full text-xs font-medium border whitespace-nowrap',
      active
        ? 'bg-success-soft text-success-fg border-success/20'
        : 'bg-surface-2 text-fg-2 border-line'
    )}
  >
    {active ? (
      <span className="relative flex h-1.5 w-1.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-60" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-success" />
      </span>
    ) : (
      <span className="h-1.5 w-1.5 rounded-full bg-fg-3" />
    )}
    {active ? activeText : inactiveText}
  </span>
);

export interface AlertProps {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

const ALERT_STYLES: Record<
  NonNullable<AlertProps['tone']>,
  { box: string; icon: LucideIcon; iconCls: string }
> = {
  info: {
    box: 'bg-brand-soft border-brand/25 text-fg',
    icon: Info,
    iconCls: 'text-brand',
  },
  success: {
    box: 'bg-success-soft border-success/25 text-fg',
    icon: CheckCircle2,
    iconCls: 'text-success',
  },
  warning: {
    box: 'bg-warning-soft border-warning/25 text-fg',
    icon: AlertTriangle,
    iconCls: 'text-warning',
  },
  danger: {
    box: 'bg-danger-soft border-danger/25 text-fg',
    icon: XCircle,
    iconCls: 'text-danger',
  },
};

export const Alert: React.FC<AlertProps> = ({
  tone = 'info',
  title,
  children,
  action,
  className,
}) => {
  const cfg = ALERT_STYLES[tone];
  const Icon = cfg.icon;
  return (
    <div
      className={cn(
        'flex items-start gap-3 px-4 py-3 rounded-lg border text-[13px]',
        cfg.box,
        className
      )}
    >
      <Icon className={cn('w-4 h-4 shrink-0 mt-0.5', cfg.iconCls)} />
      <div className="min-w-0 flex-1 leading-relaxed">
        {title && <span className="font-medium mr-1">{title}：</span>}
        <span className="text-fg-2">{children}</span>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
};

export const AdminBanner: React.FC<{ isAdmin: boolean }> = ({ isAdmin }) => {
  if (isAdmin) return null;
  return (
    <Alert tone="warning" title="当前未以管理员权限运行">
      修改 Windows 防火墙规则或绑定 80/443 低端口需要管理员权限。建议以管理员身份运行，或使用{' '}
      <code className="px-1.5 py-0.5 rounded bg-warning/15 font-mono text-xs text-fg">
        mo-server-panel.exe service install
      </code>{' '}
      安装为 Windows 系统服务。
    </Alert>
  );
};

export const EmptyState: React.FC<{
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}> = ({ icon: Icon, title, description, action }) => (
  <div className="flex flex-col items-center justify-center text-center py-14 px-6">
    <div className="h-11 w-11 rounded-full bg-surface-2 border border-line flex items-center justify-center text-fg-3 mb-3">
      <Icon className="w-5 h-5" />
    </div>
    <div className="text-sm font-medium text-fg">{title}</div>
    {description && <p className="text-xs text-fg-3 mt-1 max-w-sm leading-relaxed">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const Loading: React.FC<{ text?: string; className?: string }> = ({
  text = '加载中...',
  className,
}) => (
  <div
    className={cn(
      'flex items-center justify-center gap-2 py-16 text-[13px] text-fg-3',
      className
    )}
  >
    <Loader2 className="w-4 h-4 animate-spin" />
    <span>{text}</span>
  </div>
);

export const ProgressBar: React.FC<{
  value: number;
  tone?: 'brand' | 'success' | 'warning' | 'danger';
  size?: 'sm' | 'md';
  className?: string;
}> = ({ value, tone, size = 'md', className }) => {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const resolvedTone =
    tone ?? (clamped < 70 ? 'brand' : clamped < 85 ? 'warning' : 'danger');
  const barToneCls: Record<'brand' | 'success' | 'warning' | 'danger', string> = {
    brand: 'bg-brand',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
  };
  return (
    <div
      className={cn(
        'w-full bg-surface-2 rounded-full overflow-hidden',
        size === 'sm' ? 'h-1.5' : 'h-2',
        className
      )}
    >
      <div
        className={cn('h-full rounded-full transition-all duration-500', barToneCls[resolvedTone])}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
};

export const CodeBlock: React.FC<{
  children: React.ReactNode;
  maxHeight?: string;
  wrap?: boolean;
  className?: string;
}> = ({ children, maxHeight, wrap = false, className }) => (
  <pre
    className={cn(
      'rounded-lg border border-line bg-[#0b0d12] text-zinc-200 font-mono text-xs leading-relaxed p-4 overflow-auto',
      wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre',
      className
    )}
    style={maxHeight ? { maxHeight } : undefined}
  >
    {children}
  </pre>
);

/* -------------------------------------------------------------------------- */
/*                                    Modal                                   */
/* -------------------------------------------------------------------------- */

export const Modal: React.FC<{
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  wide?: boolean;
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}> = ({ open, title, description, onClose, wide, size, children }) => {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!open) return null;

  const widthCls = wide
    ? 'max-w-3xl'
    : size === 'sm'
      ? 'max-w-md'
      : size === 'lg'
        ? 'max-w-3xl'
        : 'max-w-lg';

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-zinc-950/40 dark:bg-black/60 backdrop-blur-[2px] animate-overlay"
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'bg-surface border border-line rounded-xl shadow-2xl animate-dialog w-full max-h-[88vh] flex flex-col overflow-hidden',
          widthCls
        )}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-line">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
            {description && <p className="text-xs text-fg-3 mt-1">{description}</p>}
          </div>
          <IconButton icon={X} title="关闭弹窗" size="sm" onClick={onClose} />
        </div>
        <div className="p-6 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
};

export const ModalFooter: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <div className={cn('flex justify-end gap-2 pt-5 mt-1 border-t border-line', className)}>
    {children}
  </div>
);
