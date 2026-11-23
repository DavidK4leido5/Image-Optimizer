import type { Toast } from '../hooks/useToasts';

type Props = {
  toasts: Toast[];
  onDismiss: (id: number) => void;
};

export function Toasts({ toasts, onDismiss }: Props) {
  return (
    <div className="toasts" role="status" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div key={toast.id} className={'toast toast--' + toast.tone}>
          <span>{toast.message}</span>
          <button type="button" className="toast__close" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
