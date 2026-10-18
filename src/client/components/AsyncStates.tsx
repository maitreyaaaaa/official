import { LoaderCircle, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';

export function LoadingStatus({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`async-loading ${className}`} role="status">
    <LoaderCircle className="async-spinner" size={15} aria-hidden="true" />
    <span>{children}</span>
  </span>;
}

export function SkeletonLines({ count = 3, className = '' }: { count?: number; className?: string }) {
  return <div className={`skeleton-lines ${className}`} aria-hidden="true">
    {Array.from({ length: count }, (_, index) => <span className={`skeleton-line skeleton-line-${index + 1}`} key={index} />)}
  </div>;
}

export function ErrorNotice({ title, message, onRetry, className = '' }: {
  title: string;
  message: string;
  onRetry: () => void;
  className?: string;
}) {
  return <div className={`async-error ${className}`} role="alert">
    <div><strong>{title}</strong><p>{message}</p></div>
    <button type="button" className="async-error-retry" onClick={onRetry}>
      <RotateCw size={14} aria-hidden="true" /> Retry
    </button>
  </div>;
}
