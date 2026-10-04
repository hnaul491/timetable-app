import { useEffect, useRef, useState } from "react";
import { useT, type MessageKey } from "../i18n";
import { GROUP_TITLE, groupOfId, SHORTCUT_CATALOG, SHORTCUT_GROUPS, type ShortcutGroup } from "../lib/shortcutCatalog";
import { comboFromEvent, formatKeys, isModifierKey, isReserved, isSequence, keysConflict, parseKeys } from "../lib/shortcutKeys";
import { useSaveShortcutPrefs, useShortcutSettings } from "../lib/shortcutPrefs";
import { effectiveKeys, useShortcutList, type ShortcutOverrides } from "../lib/shortcuts";
import { useConfirm } from "./ui/Confirm";

interface Row {
  id: string;
  label: MessageKey;
  defaultKeys: string;
  group: ShortcutGroup;
}

const SEQUENCE_MS = 1000;
const button = "h-8 rounded-lg border border-line bg-surface px-2.5 text-xs font-semibold text-ink hover:bg-subtle";

function Keys({ keys }: { keys: string }) {
  const t = useT();
  return (
    <span className="flex items-center gap-1">
      {formatKeys(keys).map((k, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && isSequence(keys) && <span className="text-xs text-muted">{t("shortcuts.then")}</span>}
          <kbd className="min-w-6 rounded-md border border-line bg-subtle px-1.5 py-0.5 text-center text-xs font-semibold text-ink-2">{k}</kbd>
        </span>
      ))}
    </span>
  );
}

/**
 * Records one combination, or two plain keys in a row ("g c"). A plain first key waits a moment for a second one.
 * Runs in the capture phase and stops the event, so the shortcuts themselves never see the keys being recorded.
 */
function useCapture(active: boolean, onKeys: (keys: string) => void, onCancel: () => void, onWaiting: (first: string | null) => void) {
  const callbacks = useRef({ onKeys, onCancel, onWaiting });
  callbacks.current = { onKeys, onCancel, onWaiting };
  useEffect(() => {
    if (!active) return;
    let first: string | null = null;
    let timer: number | undefined;
    const clear = () => {
      window.clearTimeout(timer);
      first = null;
      callbacks.current.onWaiting(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (isModifierKey(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (e.key === "Escape" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        clear();
        callbacks.current.onCancel();
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return;
      if (isReserved(combo)) {
        clear();
        callbacks.current.onKeys(combo);
        return;
      }
      const parsed = parseKeys(combo);
      const plain = !parsed.mod && !parsed.alt && !parsed.shift;
      if (first !== null && plain) {
        const keys = `${first} ${combo}`;
        clear();
        callbacks.current.onKeys(keys);
        return;
      }
      clear();
      if (plain) {
        first = combo;
        callbacks.current.onWaiting(combo);
        timer = window.setTimeout(() => {
          const only = first;
          clear();
          if (only) callbacks.current.onKeys(only);
        }, SEQUENCE_MS);
      } else {
        callbacks.current.onKeys(combo);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.clearTimeout(timer);
    };
  }, [active]);
}

export function ShortcutSettings() {
  const t = useT();
  const confirm = useConfirm();
  const live = useShortcutList();
  const { overrides, singleKey, hints } = useShortcutSettings();
  const save = useSaveShortcutPrefs();
  const [capturing, setCapturing] = useState<string | null>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (capturing) cancelButton.current?.focus();
  }, [capturing]);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(null);
  const [conflict, setConflict] = useState<{ id: string; keys: string; other: Row } | null>(null);

  const rows: Row[] = [
    ...SHORTCUT_CATALOG.map(({ id, label, keys, group }) => ({ id, label, defaultKeys: keys, group })),
    ...live
      .filter((s) => !SHORTCUT_CATALOG.some((c) => c.id === s.id))
      .map((s) => ({ id: s.id, label: s.label, defaultKeys: s.defaultKeys, group: groupOfId(s.id) })),
  ];
  const keysOf = (row: Row) => effectiveKeys(row.id, row.defaultKeys, overrides);

  const commit = (next: ShortcutOverrides) => save({ shortcuts: next });
  /** Sets one shortcut's keys (null = off); keys equal to the default are stored as no override. */
  const withKeys = (base: ShortcutOverrides, row: Row, keys: string | null): ShortcutOverrides => {
    const next = { ...base };
    if (keys === row.defaultKeys) delete next[row.id];
    else next[row.id] = keys;
    return next;
  };

  const stop = () => {
    setCapturing(null);
    setWaiting(null);
  };
  const row = rows.find((r) => r.id === capturing) ?? null;

  const onKeys = (keys: string) => {
    if (!row) return;
    stop();
    setConflict(null);
    if (isReserved(keys)) {
      setProblem({ id: row.id, text: t("shortcuts.settings.reserved", { keys: formatKeys(keys).join("+") }) });
      return;
    }
    setProblem(null);
    const other = rows.find(
      (r) => r.id !== row.id && keysOf(r) !== null && keysConflict(keysOf(r)!, keys) && (r.group === row.group || r.group === "everywhere" || row.group === "everywhere"),
    );
    if (other) {
      setConflict({ id: row.id, keys, other });
      return;
    }
    commit(withKeys(overrides, row, keys));
  };
  useCapture(capturing !== null, onKeys, stop, setWaiting);

  const swap = () => {
    if (!conflict) return;
    const target = rows.find((r) => r.id === conflict.id);
    if (!target) return;
    const mine = keysOf(target);
    commit(withKeys(withKeys(overrides, target, conflict.keys), conflict.other, mine));
    setConflict(null);
  };

  const resetAll = async () => {
    const ok = await confirm({
      title: t("shortcuts.settings.resetAllTitle"),
      body: t("shortcuts.settings.resetAllBody"),
      confirmLabel: t("shortcuts.settings.resetAll"),
      tone: "danger",
    });
    if (ok) commit({});
  };

  const startCapture = (id: string) => {
    setProblem(null);
    setConflict(null);
    setWaiting(null);
    setCapturing(id);
  };

  const customised = Object.keys(overrides).length;
  const shown = SHORTCUT_GROUPS.map((group) => ({ group, items: rows.filter((r) => r.group === group) })).filter((g) => g.items.length > 0);

  return (
    <section aria-labelledby="shortcuts-heading" className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 id="shortcuts-heading" className="text-base font-bold">
            {t("settings.sections.shortcuts")}
          </h3>
          <p className="text-sm text-muted">{t("shortcuts.settings.intro")}</p>
        </div>
        {customised > 0 && (
          <button type="button" onClick={resetAll} className={button}>
            {t("shortcuts.settings.resetAll")}
          </button>
        )}
      </div>
      <label className="flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={singleKey}
          onChange={(e) => save({ single_key_shortcuts: e.target.checked })}
          aria-describedby="single-key-help"
          className="mt-0.5"
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold text-ink-2">{t("shortcuts.settings.singleKey")}</span>
          <span id="single-key-help" className="text-xs text-muted">
            {t("shortcuts.settings.singleKeyHelp")}
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" checked={hints} onChange={(e) => save({ shortcut_hints: e.target.checked })} aria-describedby="hints-help" className="mt-0.5" />
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold text-ink-2">{t("shortcuts.settings.hints")}</span>
          <span id="hints-help" className="text-xs text-muted">
            {t("shortcuts.settings.hintsHelp")}
          </span>
        </span>
      </label>
      {shown.map(({ group, items }) => (
        <div key={group} role="group" aria-label={t(GROUP_TITLE[group])} className="flex flex-col gap-1">
          <h4 className="text-xs font-bold uppercase tracking-wide text-muted">{t(GROUP_TITLE[group])}</h4>
          <ul className="flex flex-col divide-y divide-line">
            {items.map((r) => {
              const keys = keysOf(r);
              const label = t(r.label);
              const custom = Object.prototype.hasOwnProperty.call(overrides, r.id);
              const isCapturing = capturing === r.id;
              const note = problem?.id === r.id ? problem.text : null;
              const swapping = conflict?.id === r.id ? conflict : null;
              return (
                <li key={r.id} data-shortcut={r.id} className="flex flex-col gap-1.5 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <span className="flex items-center gap-2 text-sm">
                      {label}
                      {custom && (
                        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-strong">{t("shortcuts.settings.customised")}</span>
                      )}
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      {isCapturing ? (
                        <span className="rounded-md border border-accent px-2 py-1 text-xs font-semibold text-accent-strong">
                          {waiting ? <Keys keys={waiting} /> : t("shortcuts.settings.capturePrompt")}
                        </span>
                      ) : keys === null ? (
                        <span className="text-xs text-muted">{t("shortcuts.settings.off")}</span>
                      ) : (
                        <Keys keys={keys} />
                      )}
                      {isCapturing ? (
                        <button ref={cancelButton} type="button" onClick={stop} className={button}>
                          {t("shortcuts.settings.cancel")}
                        </button>
                      ) : (
                        <>
                          <button type="button" onClick={() => startCapture(r.id)} aria-label={t("shortcuts.settings.changeFor", { label })} className={button}>
                            {t("shortcuts.settings.change")}
                          </button>
                          {custom && (
                            <button
                              type="button"
                              onClick={() => commit(withKeys(overrides, r, r.defaultKeys))}
                              aria-label={t("shortcuts.settings.resetFor", { label })}
                              className={button}
                            >
                              {t("shortcuts.settings.reset")}
                            </button>
                          )}
                          {keys === null ? (
                            <button
                              type="button"
                              onClick={() => commit(withKeys(overrides, r, r.defaultKeys))}
                              aria-label={t("shortcuts.settings.turnOnFor", { label })}
                              className={button}
                            >
                              {t("shortcuts.settings.turnOn")}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => commit(withKeys(overrides, r, null))}
                              aria-label={t("shortcuts.settings.turnOffFor", { label })}
                              className={button}
                            >
                              {t("shortcuts.settings.turnOff")}
                            </button>
                          )}
                        </>
                      )}
                    </span>
                  </div>
                  {isCapturing && (
                    <p role="status" className="text-xs text-muted">
                      {waiting ? t("shortcuts.settings.captureWaiting", { key: formatKeys(waiting).join("+") }) : t("shortcuts.settings.captureHint")}
                    </p>
                  )}
                  {note && (
                    <p role="alert" className="text-xs text-danger">
                      {note}
                    </p>
                  )}
                  {swapping && (
                    <div role="alert" className="flex flex-col gap-1.5 text-xs">
                      <p className="text-danger">
                        {t("shortcuts.settings.conflict", { keys: formatKeys(swapping.keys).join("+"), other: t(swapping.other.label) })}
                      </p>
                      <p className="text-muted">{t("shortcuts.settings.swapNote", { other: t(swapping.other.label), label })}</p>
                      <span className="flex gap-2">
                        <button type="button" onClick={swap} className={button}>
                          {t("shortcuts.settings.swap")}
                        </button>
                        <button type="button" onClick={() => setConflict(null)} className={button}>
                          {t("shortcuts.settings.cancel")}
                        </button>
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
