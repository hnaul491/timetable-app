import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../i18n";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let openDialogs = 0;
let savedOverflow = "";

/** Keeps the page behind open dialogs unreachable and unscrollable; nested dialogs share one lock. */
function lockPage(): () => void {
  const root = document.getElementById("root");
  if (openDialogs === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  openDialogs += 1;
  root?.setAttribute("inert", "");
  return () => {
    openDialogs -= 1;
    if (openDialogs === 0) {
      root?.removeAttribute("inert");
      document.body.style.overflow = savedOverflow;
    }
  };
}

export type DialogSize = "sm" | "md" | "side";

const PANEL: Record<DialogSize, string> = {
  sm: "w-full max-w-sm rounded-2xl",
  md: "w-full max-w-lg rounded-2xl max-h-[90vh]",
  side: "w-full max-h-[85vh] rounded-t-2xl md:max-h-none md:h-full md:max-w-md md:rounded-none md:rounded-l-2xl",
};
const PLACE: Record<DialogSize, string> = {
  sm: "items-center justify-center p-4",
  md: "items-end justify-center p-0 md:items-center md:p-4",
  side: "items-end justify-center md:items-stretch md:justify-end",
};

export function Dialog({ open, onClose, title, size = "md", children, footer }: {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: DialogSize;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const t = useT();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = panel.current;
    if (!node) return;
    const unlock = lockPage();
    (node.querySelector<HTMLElement>("[data-autofocus]") ?? node.querySelector<HTMLElement>(FOCUSABLE) ?? node).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    node.addEventListener("keydown", onKey);
    return () => {
      node.removeEventListener("keydown", onKey);
      unlock();
      opener?.focus();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className={`fixed inset-0 z-50 flex bg-backdrop ${PLACE[size]}`} onMouseDown={(e) => e.target === e.currentTarget && closeRef.current()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`flex flex-col overflow-hidden border border-line bg-surface text-ink shadow-xl ${PANEL[size]}`}
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <h2 id={titleId} className="mr-auto text-base font-bold">
            {title}
          </h2>
          <button type="button" aria-label={t("ui.close")} onClick={() => closeRef.current()} className="flex size-9 items-center justify-center rounded-lg text-lg text-muted hover:bg-subtle">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
