import { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  filterLabel?: string;
  count?: string;
  actionLabel?: string;
  onAction?: () => void;
  children?: ReactNode;
}

export default function PageHeader({ title, filterLabel, count, actionLabel, onAction, children }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-card min-h-[56px]">
      <div className="flex items-center gap-4">
        <h1 className="text-[13px] font-semibold uppercase tracking-wider text-foreground/80">{title}</h1>
        {children}
      </div>
      <div className="flex items-center gap-4">
        {filterLabel && (
          <span className="text-xs px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary font-medium">
            {filterLabel}
          </span>
        )}
        {count && <span className="text-xs text-muted-foreground">{count}</span>}
        {actionLabel && (
          <button
            onClick={onAction}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            + {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
