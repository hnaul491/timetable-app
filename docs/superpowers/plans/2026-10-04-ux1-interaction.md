# UX-1 — Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Work on the calendar without page jumps (details and create/edit popups), confirm destructive actions in a real dialog, see loading/success/failure feedback everywhere, drive the app from the keyboard, and use a full-screen calendar and collapsible sidebar.

**Architecture:** Small in-house UI primitives (`Dialog`, `ConfirmProvider/useConfirm`, `ToastProvider/useToast`, `TopProgress`, `Skeleton`), a shortcut engine (`ShortcutProvider/useShortcut` + help overlay) and a `ChromeProvider` for sidebar/full-screen state, then adopted by the calendar (popups driven by URL params) and the other screens.

**Tech Stack:** React 19, TS, Tailwind 4 tokens, TanStack Query, react-router, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-04-ux1-interaction-design.md`

## Global Constraints
- $0, no new dependencies; no browser `confirm()`/`alert()`.
- All new UI text through `useT()`; English and Vietnamese added together (the i18n key-parity test must pass); existing English texts unchanged unless a test is updated on purpose.
- Only colour tokens (the guard test bans `[#…]`, `bg-white`, `text-white`, `*-black`).
- Accessible: real buttons/links, focus management in dialogs, `aria-live` for toasts, keyboard reachable everything.
- Shortcuts never fire while typing (except `Mod+s`), never bind browser-reserved combos (Ctrl+N/T/W, Ctrl+Shift+N/T/W, Ctrl+Tab).
- Run `cd frontend && npx vitest run && npm run build`; delete `frontend/tsconfig.tsbuildinfo` if created. Files use CRLF — prefer the Edit tool for multi-line edits.
- Implementers: Sonnet or stronger. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus
1. **Opening a popup and pressing browser Back** closes the popup instead of leaving the calendar — Task 3 `Back closes the event panel`.
2. **Typing "n" or arrows in a note/input** never triggers shortcuts; Ctrl/⌘+S still saves — Task 2 `ignores single keys while typing`.
3. **A dialog is open and the user presses N / G C** — nothing happens behind it — Task 2 `dialogs block page shortcuts`.
4. **Deleting from the panel and cancelling the confirm** keeps the event — Task 3 `cancelled delete keeps the event`.
5. **A failed save shows a toast with Retry** that really retries — Task 1 `error toast retries`.

---

## File Structure
```
frontend/src/
├─ components/ui/Dialog.tsx, Confirm.tsx, Toast.tsx, TopProgress.tsx, Skeleton.tsx (+ ui.test.tsx)      Task 1
├─ i18n/{en,vi}/ui.ts, i18n/{en,vi}/shortcuts.ts (registered in both index.ts)                          Task 1 (shortcuts empty) / Task 2 fills
├─ lib/shortcuts.tsx (+ shortcuts.test.tsx), components/ShortcutHelp.tsx                                Task 2
├─ lib/chrome.tsx (+ chrome.test.tsx), components/Layout.tsx (collapse, full screen, nav shortcuts)       Task 2
├─ components/EventForm.tsx, components/EventPanel.tsx, pages/CalendarPage.tsx, components/WeekGrid.tsx,
│  pages/NewEventPage.tsx, pages/EventPage.tsx                                                           Task 3
├─ pages/BoardPage.tsx, SubjectsPage.tsx, SubjectPage.tsx, ReviewPage.tsx, SettingsPage.tsx,
│  components/RecurringList.tsx, SubjectSettings.tsx, SemesterSettings.tsx, GoogleSettings.tsx           Task 4
└─ App.tsx, index.css                                                                                    Task 1 (providers, backdrop token), Task 2 (shortcut/chrome providers)
```
**Order:** Task 1 → Task 2 (lane A, sequential); then Tasks 3 and 4 in parallel (disjoint files); then ship.

---

### Task 1: UI primitives — Dialog, Confirm, Toasts, TopProgress, Skeleton

**Files:** create the five `components/ui/*.tsx`, `components/ui/ui.test.tsx`, `i18n/en/ui.ts`, `i18n/vi/ui.ts`, `i18n/en/shortcuts.ts` (`export const shortcuts = {};`), `i18n/vi/shortcuts.ts` (`export const shortcuts: Messages["shortcuts"] = {};`); modify `i18n/en/index.ts`, `i18n/vi/index.ts` (add `ui`, `shortcuts`), `index.css` (backdrop token), `App.tsx` (providers + TopProgress).

**Interfaces (Produces):**
- `Dialog({ open, onClose, title, size?: "sm"|"md"|"side", children, footer? })` — focuses `[data-autofocus]` or the first focusable element, traps Tab, Esc/backdrop close (Esc keydown stops propagation), returns focus to the opener; renders `role="dialog" aria-modal="true"`.
- `ConfirmProvider`, `useConfirm(): (o: { title: string; body?: string; confirmLabel: string; tone?: "danger"|"default" }) => Promise<boolean>` (without provider resolves `false`).
- `ToastProvider`, `useToast(): { success(text: string): void; error(text: string, opts?: { retry?: () => void }): void }` (without provider: no-ops).
- `TopProgress()` (fixed bar, `data-busy="true"|"false"`), `Skeleton({ className? })`, `SkeletonRows({ rows?: number })`.
- i18n `ui`: `close`, `cancel`, `retry`, `dismiss`, `loading`.

- [ ] **Step 1: Failing tests** — `frontend/src/components/ui/ui.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider, useConfirm } from "./Confirm";
import { Dialog } from "./Dialog";
import { ToastProvider, useToast } from "./Toast";
import { TopProgress } from "./TopProgress";

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Edit">
        <button type="button">First</button>
        <button type="button">Last</button>
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  it("traps focus, closes on Escape and returns focus", async () => {
    render(<DialogHarness />);
    const opener = screen.getByRole("button", { name: "Open" });
    await userEvent.click(opener);
    expect(screen.getByRole("dialog", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
    await userEvent.tab();
    await userEvent.tab(); // past "Last" (and the close button) wraps around inside the dialog
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});

function ConfirmHarness({ onResult }: { onResult: (v: boolean) => void }) {
  const confirm = useConfirm();
  return (
    <button type="button" onClick={async () => onResult(await confirm({ title: "Delete class?", confirmLabel: "Delete", tone: "danger" }))}>
      Ask
    </button>
  );
}

describe("Confirm", () => {
  it("resolves true on confirm and false on cancel", async () => {
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <ConfirmHarness onResult={onResult} />
      </ConfirmProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onResult).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onResult).toHaveBeenLastCalledWith(false);
  });
});

function ToastHarness({ retry }: { retry: () => void }) {
  const toast = useToast();
  return (
    <>
      <button type="button" onClick={() => toast.success("Saved")}>Ok</button>
      <button type="button" onClick={() => toast.error("Couldn't save", { retry })}>Fail</button>
    </>
  );
}

describe("Toasts", () => {
  afterEach(() => vi.useRealTimers());

  it("success hides after 4 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <ToastProvider>
        <ToastHarness retry={() => {}} />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Ok" }));
    expect(screen.getByText("Saved")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(4100));
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("error toast retries", async () => {
    const retry = vi.fn();
    render(
      <ToastProvider>
        <ToastHarness retry={retry} />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Fail" }));
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalled();
    expect(screen.queryByText("Couldn't save")).not.toBeInTheDocument();
  });
});

describe("TopProgress", () => {
  it("shows while a query is loading", async () => {
    let resolve: (v: number) => void = () => {};
    function Loader() {
      useQuery({ queryKey: ["slow"], queryFn: () => new Promise<number>((r) => (resolve = r)) });
      return null;
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TopProgress />
        <Loader />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("top-progress")).toHaveAttribute("data-busy", "true");
    await act(async () => resolve(1));
    expect(screen.getByTestId("top-progress")).toHaveAttribute("data-busy", "false");
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `cd frontend && npx vitest run src/components/ui`.

- [ ] **Step 3: i18n + token** — `i18n/en/ui.ts`:

```ts
export const ui = {
  close: "Close",
  cancel: "Cancel",
  retry: "Retry",
  dismiss: "Dismiss",
  loading: "Loading",
};
```

`i18n/vi/ui.ts`: same keys typed `Messages["ui"]` — `close: "Đóng", cancel: "Huỷ", retry: "Thử lại", dismiss: "Ẩn", loading: "Đang tải"`. Add `ui` and `shortcuts` to both `en/index.ts` and `vi/index.ts`.

`index.css`: add `--color-backdrop: var(--tt-backdrop);` to `@theme inline`, `--tt-backdrop: rgb(21 23 28 / 0.45);` to `:root`, `--tt-backdrop: rgb(0 0 0 / 0.6);` to `:root[data-theme="dark"]`.

- [ ] **Step 4: Dialog** — `components/ui/Dialog.tsx`:

```tsx
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../i18n";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
      if (e.shiftKey && document.activeElement === first) {
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
```

(The test's tab order: First, Last are inside the body; the close button comes first in DOM order. Adjust the test's tab count if needed but keep the assertion that focus stays inside the dialog.)

- [ ] **Step 5: Confirm** — `components/ui/Confirm.tsx`:

```tsx
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
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
  const ask = useCallback<Ask>((options) => new Promise((resolve) => setPending({ ...options, resolve })), []);
  const finish = (value: boolean) => {
    pending?.resolve(value);
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
```

- [ ] **Step 6: Toasts** — `components/ui/Toast.tsx`:

```tsx
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
```

- [ ] **Step 7: TopProgress + Skeleton**

`components/ui/TopProgress.tsx`:

```tsx
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { useT } from "../../i18n";

export function TopProgress() {
  const t = useT();
  const busy = useIsFetching() + useIsMutating() > 0;
  return (
    <div
      data-testid="top-progress"
      data-busy={busy ? "true" : "false"}
      role="progressbar"
      aria-label={t("ui.loading")}
      aria-hidden={!busy}
      className={`pointer-events-none fixed inset-x-0 top-0 z-[70] h-0.5 transition-opacity ${busy ? "opacity-100" : "opacity-0"}`}
    >
      <div className="h-full w-full animate-pulse bg-accent" />
    </div>
  );
}
```

`components/ui/Skeleton.tsx`:

```tsx
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg bg-subtle ${className}`} />;
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
```

- [ ] **Step 8: App wiring** — in `App.tsx`, inside `<LanguageRoot>` wrap the router: `<ToastProvider><ConfirmProvider><TopProgress /><BrowserRouter>…</BrowserRouter></ConfirmProvider></ToastProvider>`.

- [ ] **Step 9: Run and commit** — `npx vitest run && npm run build`; commit `feat(frontend): dialog, confirm, toasts, progress bar and skeleton primitives`.

---

### Task 2: Shortcut engine, help overlay, collapsible sidebar, full screen

**Files:** create `lib/shortcuts.tsx`, `lib/shortcuts.test.tsx`, `components/ShortcutHelp.tsx`, `lib/chrome.tsx`, `lib/chrome.test.tsx`; modify `components/Layout.tsx`, `App.tsx`, `i18n/en/shortcuts.ts`, `i18n/vi/shortcuts.ts`, `i18n/en/nav.ts`, `i18n/vi/nav.ts` (sidebar toggle labels).

**Interfaces (Produces):**
- `ShortcutProvider({ children })`, `useShortcut(id: string, keys: string, handler: (e: KeyboardEvent) => void, options?: { label?: MessageKey; inDialog?: boolean; enabled?: boolean })`, `formatKeys(keys: string, mac?: boolean): string[]`, `useShortcutList(): { id; keys; label }[]`.
- Key strings: `"n"`, `"ArrowLeft"`, `"?"`, `"["`, `"Escape"`, `"Delete"`, `"g c"` (sequence, 1 s), `"Mod+s"` (Ctrl or ⌘).
- Rules: when focus is in input/textarea/select/contenteditable only `Mod+…` bindings fire; when an element `[aria-modal="true"]` exists only bindings with `inDialog: true` fire; a fired binding calls `preventDefault()`.
- `ChromeProvider`, `useChrome(): { sidebarCollapsed: boolean; toggleSidebar(): void; fullScreen: boolean; setFullScreen(v: boolean): void }` (sidebar persisted in localStorage `timetable:sidebar`, safe try/catch; full screen not persisted).
- Layout: collapsed sidebar = icon rail (inline SVG icons, `aria-label` + `title` = translated names); toggle button at the bottom; full screen hides both navs; floating "Exit full screen" button; shortcuts `[` toggle sidebar, `Escape` exits full screen, `g c/b/s/r/,` navigate, `?` opens `ShortcutHelp` (Dialog listing `useShortcutList()` with `formatKeys`, translated labels; Mod shows "Ctrl" or "⌘").

- [ ] **Step 1: Failing tests** — `lib/shortcuts.test.tsx` must cover (write them concretely with `render` + `userEvent.keyboard`):
  - `fires single keys and sequences` — `useShortcut("new","n",fn)` fires on `n`; `useShortcut("go","g c",fn2)` fires on `g` then `c`, not on `c` alone, not when the gap exceeds 1 s (fake timers).
  - `ignores single keys while typing` — focus an `<input>`, type `n` → not fired; `Mod+s` binding fires on `{Control>}s{/Control}` inside the input and `preventDefault` was called.
  - `dialogs block page shortcuts` — with an element `<div aria-modal="true">` in the document, `n` does not fire; a binding with `inDialog: true` (`Mod+s`) still fires.
  - `formatKeys` — `formatKeys("Mod+s", false)` → `["Ctrl", "S"]`, `formatKeys("Mod+s", true)` → `["⌘", "S"]`, `formatKeys("g c")` → `["G", "C"]`.
  `lib/chrome.test.tsx`: `toggleSidebar` persists `collapsed` and reads it back; survives blocked storage; `setFullScreen(true)` exposes `fullScreen: true`. Layout test (add to an existing or new `components/Layout.test.tsx`): pressing `[` collapses the sidebar (nav shows only icons: links still have accessible names); `g` then `b` navigates to `/board` (render inside `MemoryRouter` with a `Routes` that renders a marker per path); `?` opens a dialog named by `t("shortcuts.title")`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `lib/shortcuts.tsx` (window `keydown` listener in the provider; registry in a ref; normalise `e.key` — letters lower-case, `Mod` = `ctrlKey || metaKey`, ignore events with `altKey`; sequence state `{ prefix, at }`), `lib/chrome.tsx`, `ShortcutHelp.tsx`, Layout changes, and wire `ShortcutProvider` + `ChromeProvider` in `App.tsx` (inside `ConfirmProvider`, around `BrowserRouter`; Layout's navigation shortcuts use `useNavigate`, so register them inside Layout).
  i18n `shortcuts` (en → vi): `title: "Keyboard shortcuts"` → "Phím tắt"; `newEvent: "New event"` → "Sự kiện mới"; `previous: "Previous week or day"` → "Tuần hoặc ngày trước"; `next: "Next week or day"` → "Tuần hoặc ngày sau"; `today: "Go to today"` → "Về hôm nay"; `weekView: "Week view"` → "Xem theo tuần"; `dayView: "Day view"` → "Xem theo ngày"; `fullScreen: "Full-screen calendar"` → "Lịch toàn màn hình"; `exitFullScreen: "Exit full screen"` → "Thoát toàn màn hình"; `toggleSidebar: "Collapse or expand the sidebar"` → "Thu gọn hoặc mở rộng thanh bên"; `goCalendar: "Go to Calendar"` → "Đến Lịch"; `goBoard: "Go to Board"` → "Đến Bảng việc"; `goSubjects: "Go to Subjects"` → "Đến Môn học"; `goReview: "Go to Review"` → "Đến Ôn tập"; `goSettings: "Go to Settings"` → "Đến Cài đặt"; `save: "Save"` → "Lưu"; `delete: "Delete"` → "Xoá"; `help: "Show shortcuts"` → "Hiện phím tắt"; `then: "then"` → "rồi". nav additions: `collapse: "Collapse sidebar"` → "Thu gọn thanh bên", `expand: "Expand sidebar"` → "Mở rộng thanh bên".
- [ ] **Step 4: Run and commit** — `feat(frontend): keyboard shortcuts, help overlay, collapsible sidebar and full-screen mode`.

---

### Task 3: Calendar popups (details, create, edit) and calendar shortcuts

**Files:** create `components/EventForm.tsx`, `components/EventPanel.tsx`, `pages/CalendarPage.popups.test.tsx`; modify `pages/CalendarPage.tsx`, `components/WeekGrid.tsx`, `pages/NewEventPage.tsx` (use `EventForm`), `pages/EventPage.tsx` (delete via `useConfirm`, toasts on save/star/delete), `i18n/{en,vi}/calendar.ts`, `i18n/{en,vi}/event.ts`.

**Behaviour (from the spec, §2–3):**
- `EventForm({ initial?: Partial<FormValues>, eventId?: number, onDone(eventId: number), onCancel() })` — the form currently inside `NewEventPage` (one-off / weekly, kinds, date, times, until, room) moved into a component; `NewEventPage` renders it with `onDone={(id) => navigate(`/events/${id}`)}`; editing uses `PUT /api/events/{id}` (own events) with values prefilled from the event. `Mod+s` submits (`useShortcut("form-save", "Mod+s", submit, { inDialog: true, label: "shortcuts.save" })`).
- `EventPanel({ eventId, onClose, onEdit })` — `Dialog size="side"` titled by the event title: colour dot, date/time/room (locale dates), status badges, ★ important toggle (same endpoint as EventPage), notes preview (first 3 lines of each non-empty tab), open tasks with checkboxes (PATCH), "Next class" button (switches the panel to that event), actions: **Open full page** (link `/events/:id`), **Edit** and **Delete** (own events only; Delete → `confirm({ tone: "danger" })` → `DELETE` → toast → close). `Mod+d` and `Delete` trigger delete (`inDialog: true`).
- `CalendarPage`: reads `event`, `new`, `edit` search params (with existing `date`/`view`); opening = `setParams` with **push** (not replace) so Back closes; closing removes the param with replace. Event block click → `?event=id` (instead of navigating). "Add event" button and `n` → `?new=<anchor>T09:00`. Empty-slot click in `WeekGrid` (`onCreateAt(date: string, minutes: number)` — clicking the day column background, rounded down to 30 min) → `?new=<date>T<HH:MM>`. After create → toast `event.created`, open `?event=<newId>`. Shortcuts on the calendar: `ArrowLeft`/`ArrowRight`, `t`, `w`, `d`, `n`, `f` (full screen via `useChrome`), each with a `shortcuts.*` label.
- `EventPage`: replace the two-click delete with `useConfirm`, add toasts for note saved / star / deleted / errors (`toast.error(message, { retry })`).

- [ ] **Step 1: Failing tests** — `pages/CalendarPage.popups.test.tsx` (mock `apiFetch` by path like the existing CalendarPage tests; wrap in `QueryClientProvider`, `ToastProvider`, `ConfirmProvider`, `ShortcutProvider`, `ChromeProvider`, `MemoryRouter` with a location display):
  - `clicking an event opens the panel` — the URL gets `event=<id>`; a dialog named after the event title shows date, room and "Open full page".
  - `Back closes the event panel` — use a `MemoryRouter` with `initialEntries` and a test button calling `navigate(-1)`; after opening then going back the dialog is gone and the URL has no `event`.
  - `empty slot opens a prefilled create form` — clicking the grid background of a day (use `fireEvent.click` on the day column with `clientY` mapped to 10:30 or call the exposed `onCreateAt` through a button rendered by WeekGrid for tests — prefer real click with `getBoundingClientRect` mocked) opens a dialog with the date and `10:30` prefilled.
  - `creating shows a toast and the new event` — submit the form (mock POST → `{ id: 99, … }`), expect a toast with `translate("en","event.created")` and URL `event=99`.
  - `cancelled delete keeps the event` / `confirmed delete removes it` — for a custom event: Delete → confirm dialog → Cancel → no DELETE call; again → confirm → DELETE called, toast, panel closed.
  - `n opens the create form; arrows move the week` — keyboard.
  Add/adjust EventPage tests for the confirm-based delete.
- [ ] **Step 2–3:** implement; keep `/events/:id` and `/events/new` pages working; i18n keys for every new text in `calendar`/`event` (en + vi, glossary).
- [ ] **Step 4:** `npx vitest run && npm run build`; commit `feat(frontend): calendar popups for details, create and edit, with shortcuts`.

---

### Task 4: Confirm dialog, toasts and skeletons on the other screens

**Files:** `pages/BoardPage.tsx`, `pages/SubjectsPage.tsx`, `pages/SubjectPage.tsx`, `pages/ReviewPage.tsx`, `pages/SettingsPage.tsx`, `components/RecurringList.tsx`, `components/SubjectSettings.tsx`, `components/SemesterSettings.tsx`, `components/GoogleSettings.tsx`, their tests, `i18n/{en,vi}/{board,subjects,review,settings,google}.ts`.

**Behaviour:**
- Replace every two-click confirm with `useConfirm` (danger tone): board task delete ("Delete task “{title}”?"), repeating event delete, subject merge ("Merge “{from}” into “{into}”? Its classes, tasks and notes move over."), Google disconnect (body: the existing disconnect note). New: clearing a semester's Zeus group (saving an empty group on the **active** semester asks first).
- Toasts: board add/move/delete, settings saves (Zeus link, groups, semester group, activate, subject rename/colour/hide/merge, language/theme is silent), "Sync now" result (success: `"{n} classes checked"`-style summary using existing run fields; failure: translated server message), Google push finished/failed, review "Mark week as reviewed" and task ticks. Errors use `toast.error(message, { retry })` where a retry makes sense; keep inline error texts that tests rely on, or update those tests deliberately.
- Skeletons instead of "Loading…" text on Board (three column skeletons), Subjects list, Subject page and Review page (keep an accessible `role="status"` with the loading text visually hidden, so screen readers still hear it and existing tests that look for the text can be updated to `getByRole("status")`).
- [ ] **Step 1: Failing tests** — for each converted confirm: clicking Delete/Merge/Disconnect opens a dialog; Cancel → no request; Confirm → request sent and a success toast shown. One toast test per screen group. Skeleton test: while the query is pending, `getByRole("status")` has the loading text and no list items are rendered.
- [ ] **Step 2–3:** implement with i18n keys (en + vi, glossary).
- [ ] **Step 4:** `npx vitest run && npm run build`; commit `feat(frontend): confirm dialogs, toasts and skeletons across board, subjects, review and settings`.

---

### Task 5: Ship
- [ ] Full verification (backend unchanged; frontend `npx vitest run && npm run build`).
- [ ] Push to main, `npx --yes vercel deploy --prod --yes` (retry once if the CLI answers "Not authorized"), smoke `/`, `/api/health`.
