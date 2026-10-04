import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useT } from "../../i18n";
import { Dialog } from "./Dialog";

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel: string;
  tone?: "danger" | "default";
}
type Ask = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Ask>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (value: boolean) => void }) | null>(null);
  const current = useRef<((value: boolean) => void) | null>(null);
  const ask = useCallback<Ask>((options) => {
    current.current?.(false); // a newer question replaces one still open
    return new Promise((resolve) => {
      current.current = resolve;
      setPending({ ...options, resolve });
    });
  }, []);
  const finish = (value: boolean) => {
    pending?.resolve(value);
    current.current = null;
    setPending(null);
  };
  const danger = pending?.tone === "danger";
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <Dialog
        open={pending !== null}
        onClose={() => finish(false)}
        title={pending?.title ?? ""}
        size="sm"
        footer={
          <>
            <button type="button" onClick={() => finish(false)} className="h-10 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink">
              {t("ui.cancel")}
            </button>
            <button
              type="button"
              data-autofocus
              onClick={() => finish(true)}
              className={`h-10 rounded-xl px-4 text-sm font-semibold ${danger ? "bg-danger text-on-danger" : "bg-accent text-on-accent"}`}
            >
              {pending?.confirmLabel}
            </button>
          </>
        }
      >
        {pending?.body && <p className="text-sm text-ink-2">{pending.body}</p>}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): Ask {
  return useContext(ConfirmContext);
}
