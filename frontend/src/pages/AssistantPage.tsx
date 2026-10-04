import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link, useLocation } from "react-router";
import { ActionCard } from "../components/ActionCard";
import { useConfirm } from "../components/ui/Confirm";
import { Skeleton } from "../components/ui/Skeleton";
import { useToast } from "../components/ui/Toast";
import { useLocale, useT, type MessageKey } from "../i18n";
import { apiFetch } from "../lib/api";
import { invalidateTaskViews } from "../lib/invalidate";
import type { AiStatus, ChatMessage, PendingAction } from "../types";

const PRIVACY_KEY = "timetable:ai-privacy";
const QUICK: MessageKey[] = ["ai.quickDue", "ai.quickFree", "ai.quickQuiz", "ai.quickSummary"];

function privacyDismissed(): boolean {
  try {
    return localStorage.getItem(PRIVACY_KEY) === "1";
  } catch {
    return false;
  }
}

/** Plain-text paragraphs and bullet lists; the text is never interpreted as HTML. */
function RichText({ text }: { text: string }) {
  const blocks: { bullets: boolean; lines: string[] }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = /^[-*•]\s+/.test(line);
    const last = blocks[blocks.length - 1];
    const content = bullet ? line.replace(/^[-*•]\s+/, "") : line;
    if (last && last.bullets === bullet && bullet) last.lines.push(content);
    else blocks.push({ bullets: bullet, lines: [content] });
  }
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((b, i) =>
        b.bullets ? (
          <ul key={i} className="list-disc pl-5">
            {b.lines.map((l, j) => (
              <li key={j}>{l}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{b.lines[0]}</p>
        ),
      )}
    </div>
  );
}

export function AssistantPage() {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const location = useLocation();
  const [text, setText] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [hidePrivacy, setHidePrivacy] = useState(privacyDismissed);
  const endRef = useRef<HTMLDivElement>(null);

  const status = useQuery({ queryKey: ["ai-status"], queryFn: () => apiFetch<AiStatus>("/api/ai/status") });
  const enabled = status.data?.enabled === true;
  const chat = useQuery({ queryKey: ["chat"], queryFn: () => apiFetch<{ messages: ChatMessage[] }>("/api/chat"), enabled });
  const messages = chat.data?.messages ?? [];

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, sending]);

  const send = useMutation({
    mutationFn: (message: string) =>
      apiFetch<ChatMessage>("/api/chat", { method: "POST", body: JSON.stringify({ message, context: { path: location.pathname }, locale }) }),
    onSuccess: (answer, message) => {
      queryClient.setQueryData<{ messages: ChatMessage[] }>(["chat"], (old) => {
        const list = old?.messages ?? [];
        const mine: ChatMessage = { id: -Date.now(), role: "user", content: message, actions: [] };
        return { messages: [...list, mine, answer] };
      });
    },
    onError: (error, message) => {
      setText((cur) => cur || message);
      toast.error(t("ai.sendFailed", { message: error.message }));
    },
    onSettled: () => setSending(null),
  });

  const act = useMutation({
    mutationFn: (v: { action: PendingAction; verb: "confirm" | "dismiss" }) =>
      apiFetch(`/api/actions/${v.action.id}/${v.verb}`, { method: "POST" }),
    onSuccess: (_data, v) => {
      const next = v.verb === "confirm" ? "confirmed" : "dismissed";
      queryClient.setQueryData<{ messages: ChatMessage[] }>(["chat"], (old) =>
        old && { messages: old.messages.map((m) => ({ ...m, actions: m.actions.map((a) => (a.id === v.action.id ? { ...a, status: next } : a)) })) },
      );
      if (v.verb === "confirm") {
        invalidateTaskViews(queryClient);
        toast.success(t("ai.addedToast"));
      }
      queryClient.invalidateQueries({ queryKey: ["chat"] });
    },
    onError: (error, v) => toast.error(t("ai.actionFailed", { message: error.message }), { retry: () => act.mutate(v) }),
  });

  const clear = useMutation({
    mutationFn: () => apiFetch("/api/chat", { method: "DELETE" }),
    onSuccess: () => {
      queryClient.setQueryData(["chat"], { messages: [] });
      toast.success(t("ai.cleared"));
    },
    onError: (error) => toast.error(t("ai.actionFailed", { message: error.message })),
  });
  const askClear = async () => {
    const ok = await confirm({ title: t("ai.clearTitle"), body: t("ai.clearBody"), confirmLabel: t("ai.clearConfirm"), tone: "danger" });
    if (ok) clear.mutate();
  };

  const submit = (message: string) => {
    const body = message.trim();
    if (!body || send.isPending) return;
    setText("");
    setSending(body);
    send.mutate(body);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    if (e.shiftKey && !e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    submit(text);
  };
  const dismissPrivacy = () => {
    try {
      localStorage.setItem(PRIVACY_KEY, "1");
    } catch {
      /* storage unavailable: hidden for this visit only */
    }
    setHidePrivacy(true);
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t("ai.title")}</h1>
        {enabled && messages.length > 0 && (
          <button type="button" onClick={askClear} disabled={clear.isPending} className="h-9 rounded-lg border border-line px-3 text-sm font-semibold text-ink-2 disabled:opacity-60">
            {t("ai.clear")}
          </button>
        )}
      </div>

      {!hidePrivacy && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-ink-2">
          <p className="min-w-0 flex-1">{t("ai.privacy")}</p>
          <button type="button" onClick={dismissPrivacy} className="h-9 rounded-lg border border-line bg-surface px-3 font-semibold">
            {t("ai.privacyDismiss")}
          </button>
        </div>
      )}

      {!status.data && !status.error && <Skeleton className="h-24 w-full" />}
      {status.error && <p className="text-sm text-danger">{t("ai.statusFailed", { message: status.error.message })}</p>}

      {status.data && !enabled && (
        <section className="flex flex-col items-start gap-3 rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-base font-bold">{t("ai.disabledTitle")}</h2>
          <p className="text-sm text-ink-2">{t("ai.disabledBody")}</p>
          <Link to="/settings" className="flex h-10 items-center rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-strong">
            {t("ai.openSettings")}
          </Link>
        </section>
      )}

      {enabled && (
        <>
          <div className="flex flex-col gap-3" aria-live="polite">
            {chat.error && <p className="text-sm text-danger">{t("ai.loadFailed", { message: chat.error.message })}</p>}
            {chat.isPending && <Skeleton className="h-16 w-2/3" />}
            {chat.data && messages.length === 0 && !sending && <p className="text-sm text-muted">{t("ai.empty")}</p>}
            {messages.map((m) => (
              <div key={m.id} className={`flex flex-col gap-2 ${m.role === "user" ? "items-end" : "items-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm break-words ${m.role === "user" ? "bg-accent text-on-accent" : "border border-line bg-surface"}`}
                >
                  <span className="sr-only">{m.role === "user" ? t("ai.you") : t("ai.assistant")}: </span>
                  <RichText text={m.content} />
                </div>
                {m.actions.length > 0 && (
                  <div className="flex w-full max-w-[85%] flex-col gap-2">
                    {m.actions.map((a) => (
                      <ActionCard
                        key={a.id}
                        action={a}
                        busy={act.isPending}
                        onAdd={() => act.mutate({ action: a, verb: "confirm" })}
                        onDismiss={() => act.mutate({ action: a, verb: "dismiss" })}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
            {sending && (
              <div className="flex flex-col items-end gap-2">
                <div className="max-w-[85%] rounded-2xl bg-accent px-4 py-2.5 text-sm break-words text-on-accent">
                  <RichText text={sending} />
                </div>
                <p role="status" className="self-start text-sm text-muted">
                  {t("ai.typing")}
                </p>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {messages.length === 0 && !sending && (
            <div role="group" aria-label={t("ai.quickPromptsLabel")} className="flex flex-wrap gap-2">
              {QUICK.map((k) => (
                <button key={k} type="button" onClick={() => submit(t(k))} className="rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink-2 hover:bg-subtle">
                  {t(k)}
                </button>
              ))}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(text);
            }}
            className="flex items-end gap-2"
          >
            <textarea
              aria-label={t("ai.composer")}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              maxLength={4000}
              placeholder={t("ai.placeholder")}
              className="min-w-0 flex-1 rounded-xl border border-line-strong p-3 text-sm"
            />
            <button type="submit" disabled={!text.trim() || send.isPending} className="h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-strong disabled:opacity-60">
              {t("ai.send")}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
