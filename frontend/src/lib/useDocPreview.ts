import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import type { PreviewDoc } from "./documents";

/**
 * State for the document preview dialog. `onOpen` is for the click on a file name: a modifier key keeps the browser's own
 * behaviour (new tab on the Drive link), and so does a document without a preview URL. Focus returns to the clicked row.
 */
export function useDocPreview() {
  const [state, setState] = useState<{ docs: PreviewDoc[]; index: number } | null>(null);
  const trigger = useRef<HTMLElement | null>(null);

  const onOpen = useCallback((e: MouseEvent<HTMLElement>, docs: PreviewDoc[], index: number) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (!docs[index]?.preview_url) return;
    e.preventDefault();
    trigger.current = e.currentTarget;
    setState({ docs, index });
  }, []);
  const close = useCallback(() => setState(null), []);
  const setIndex = useCallback((index: number) => setState((s) => (s ? { ...s, index } : s)), []);

  const wasOpen = useRef(false);
  useEffect(() => {
    if (state === null && wasOpen.current) trigger.current?.focus();
    wasOpen.current = state !== null;
  }, [state]);

  return { docs: state?.docs ?? [], index: state?.index ?? null, onOpen, close, setIndex };
}
