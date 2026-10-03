import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ErrorPanel } from "../components/Banners";
import { RecurringList } from "../components/RecurringList";
import { apiFetch } from "../lib/api";
import { formatTime, parisParts } from "../lib/time";
import type { SectionChoice, SyncRun, SyncStatus } from "../types";

const card = "flex flex-col gap-3 rounded-2xl border border-line bg-white p-5";
const primary = "h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-60";

function when(iso: string | null | undefined): string {
  return iso ? `${parisParts(iso).date} ${formatTime(iso)}` : "never";
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const keyStatus = useQuery({ queryKey: ["zeus-key"], queryFn: () => apiFetch<{ configured: boolean }>("/api/settings/zeus-key") });
  const sync = useQuery({ queryKey: ["sync-status"], queryFn: () => apiFetch<SyncStatus>("/api/sync/status") });
  const sections = useQuery({ queryKey: ["sections"], queryFn: () => apiFetch<SectionChoice[]>("/api/settings/sections") });
  const [link, setLink] = useState("");

  const saveKey = useMutation({
    mutationFn: (value: string) => apiFetch("/api/settings/zeus-key", { method: "PUT", body: JSON.stringify({ value }) }),
    onSuccess: () => {
      setLink("");
      queryClient.invalidateQueries({ queryKey: ["zeus-key"] });
    },
  });
  const syncNow = useMutation({
    mutationFn: () => apiFetch<SyncRun>("/api/sync", { method: "POST" }),
    onSettled: () => queryClient.invalidateQueries(),
  });
  const pick = useMutation({
    mutationFn: (body: { subject_id: number; section: string }) =>
      apiFetch("/api/settings/sections", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (link.trim()) saveKey.mutate(link.trim());
  };

  const lastRun = sync.data?.last_run;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      {keyStatus.error && <ErrorPanel error={keyStatus.error} />}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card}>
          <h2 className="text-base font-bold">School timetable (Zeus)</h2>
          <form onSubmit={submit} className="flex flex-col gap-2">
            <label htmlFor="zeus-link" className="text-sm font-semibold text-[#3A3F4B]">
              Zeus ICS subscription link
            </label>
            <div className="flex gap-2">
              <input
                id="zeus-link"
                type="password"
                autoComplete="off"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder={keyStatus.data?.configured ? "Saved. Paste a new link to replace it." : "https://zeus.ionis-it.com/api/group/…/ics/…"}
                className="h-10 min-w-0 flex-1 rounded-xl border border-[#D5D9E0] px-3 text-sm"
              />
              <button type="submit" className={primary} disabled={saveKey.isPending}>
                Save
              </button>
            </div>
            <p className="text-xs text-muted">
              In Zeus, generate the calendar link for your group and paste it here. It is stored on the server only and never shown again.
            </p>
            {saveKey.error && <p className="text-sm text-[#8B1A1A]">{(saveKey.error as Error).message}</p>}
            <p className="text-sm">{keyStatus.data?.configured ? "Link saved." : "No link saved yet."}</p>
          </form>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#F8F9FB] px-3 py-2.5 text-sm">
            <span>
              Last sync: {lastRun ? `${lastRun.status} · ${when(lastRun.finished_at)}` : "never"}
              {lastRun?.status === "ok" && ` · ${lastRun.fetched} events, ${lastRun.inserted} new, ${lastRun.updated} changed, ${lastRun.cancelled} cancelled`}
              {lastRun?.error && ` · ${lastRun.error}`}
            </span>
            <button type="button" className={primary} onClick={() => syncNow.mutate()} disabled={syncNow.isPending}>
              {syncNow.isPending ? "Syncing…" : "Sync now"}
            </button>
          </div>
          {syncNow.error && <p className="text-sm text-[#8B1A1A]">{(syncNow.error as Error).message}</p>}
        </section>
        <section className={card}>
          <h2 className="text-base font-bold">My groups</h2>
          <p className="text-sm text-muted">Zeus sends every parallel group. Pick yours, or "All groups" if you attend every one; classes without a group are always shown.</p>
          {pick.error && <p className="text-sm text-[#8B1A1A]">{(pick.error as Error).message}</p>}
          {sections.data?.length === 0 && <p className="text-sm">No grouped classes yet. Sync first.</p>}
          {sections.data?.map((choice) => (
            <label key={choice.subject_id} className="flex flex-wrap items-center justify-between gap-3 text-sm font-medium">
              {choice.subject_name}
              <select
                value={choice.chosen ?? ""}
                onChange={(e) => pick.mutate({ subject_id: choice.subject_id, section: e.target.value })}
                className="h-10 min-w-[120px] rounded-xl border border-[#D5D9E0] bg-white px-2.5 font-semibold"
              >
                {choice.chosen === null && (
                  <option value="" disabled>
                    Choose…
                  </option>
                )}
                <option value="ALL">All groups</option>
                {choice.sections.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </section>
      </div>
      <RecurringList />
    </div>
  );
}
