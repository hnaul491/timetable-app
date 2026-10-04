import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../i18n";

interface ToastItem {
  id: number;
  tone: "success" | "error";
  text: string;
  retry?: () => void;
}
export interface ToastApi {
  success(text: string): void;
  error(text: string, options?: { retry?: () => void }): void;
}

const ToastContext = createContext<ToastApi>({ success() {}, error() {} });
const SUCCESS_MS = 4000;
const MAX = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const remove = useCallback((id: number) => setItems((all) => all.filter((item) => item.id !== id)), []);
  const push = useCallback(
    (item: Omit<ToastItem, "id">) => {
      nextId.current += 1;
      const id = nextId.current;
      setItems((all) => [...all.slice(-(MAX - 1)), { ...item, id }]);
      if (item.tone === "success") window.setTimeout(() => remove(id), SUCCESS_MS);
    },
    [remove],
  );
  const api = useMemo<ToastApi>(
    () => ({
      success: (text) => push({ tone: "success", text }),
      error: (text, options) => push({ tone: "error", text, retry: options?.retry }),
    }),
    [push],
  );
  const render = (tone: ToastItem["tone"]) =>
    items
      .filter((item) => item.tone === tone)
      .map((item) => (
        <div
          key={item.id}
          className={`pointer-events-auto flex items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${
            tone === "success" ? "border-line bg-success-soft text-success" : "border-danger-line bg-danger-soft text-danger"
          }`}
        >
          <span className="mr-auto">{item.text}</span>
          {item.retry && (
            <button
              type="button"
              onClick={() => {
                remove(item.id);
                item.retry?.();
              }}
              className="font-semibold underline"
            >
              {t("ui.retry")}
            </button>
          )}
          <button type="button" aria-label={t("ui.dismiss")} onClick={() => remove(item.id)} className="text-base leading-none">
            ×
          </button>
        </div>
      ));
  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:inset-x-auto md:right-6 md:bottom-6 md:items-end">
          <div aria-live="polite" className="flex w-full max-w-sm flex-col gap-2">{render("success")}</div>
          <div aria-live="assertive" className="flex w-full max-w-sm flex-col gap-2">{render("error")}</div>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
