import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { AISettings } from "../components/AISettings";
import { AppearanceSettings } from "../components/AppearanceSettings";
import { BackupSettings } from "../components/BackupSettings";
import { GoogleSettings } from "../components/GoogleSettings";
import { MobileSemesterSwitch } from "../components/MobileSemesterSwitch";
import { SubjectSettings } from "../components/SubjectSettings";
import { useT } from "../i18n";
import { connectPending } from "../lib/google";
import { useIsDesktop } from "../lib/useMediaQuery";
import { SchoolSection } from "./settings/SchoolSection";
import { SectionList } from "./settings/SectionList";
import { SECTIONS, isSectionId, matchSections, type SectionId } from "./settings/sections";
import { useSettingsStatus } from "./settings/useSettingsStatus";

function SectionBody({ id }: { id: SectionId }) {
  switch (id) {
    case "general":
      return <AppearanceSettings />;
    case "school":
      return <SchoolSection />;
    case "subjects":
      return <SubjectSettings />;
    case "google":
      return <GoogleSettings />;
    case "ai":
      return <AISettings />;
    case "backup":
      return <BackupSettings />;
  }
}

/** Rendered with key={id}, so it re-mounts on a section change and its children play the enter animation again. */
function SectionContent({ id }: { id: SectionId }) {
  return (
    <div data-section={id} className="flex min-w-0 flex-col gap-4 motion-safe:*:animate-[settings-in_180ms_ease-out]">
      <SectionBody id={id} />
    </div>
  );
}

export function SettingsPage() {
  const t = useT();
  const navigate = useNavigate();
  const { section } = useParams();
  const desktop = useIsDesktop();
  const status = useSettingsStatus();
  const [query, setQuery] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);

  const matches = matchSections(query, (id) => t(`settings.sections.${id}`));
  const current = isSectionId(section) ? section : null;
  const effective = current ?? (desktop ? "general" : null);
  const filteredOut = desktop && effective !== null && query.trim() !== "" && matches.length > 0 && !matches.some((s) => s.id === effective);

  useEffect(() => {
    if (filteredOut) navigate(`/settings/${matches[0].id}`, { replace: true });
  });
  useEffect(() => {
    if (!desktop && current) heading.current?.focus();
  }, [desktop, current]);

  if (section !== undefined && !current) return <Navigate to="/settings" replace />;
  if (!current && connectPending()) return <Navigate to="/settings/google" replace />;
  if (!current && desktop) return <Navigate to="/settings/general" replace />;

  if (!desktop) {
    return (
      <div className="flex flex-col gap-4">
        <MobileSemesterSwitch />
        {current ? (
          <>
            <div className="flex items-center gap-2.5">
              <Link
                to="/settings"
                aria-label={t("settings.back")}
                className="flex size-9 items-center justify-center rounded-xl border border-line bg-surface text-accent-strong"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current stroke-2">
                  <path d="m15 6-6 6 6 6" />
                </svg>
              </Link>
              <h2 ref={heading} tabIndex={-1} className="text-xl font-bold outline-none">
                {t(`settings.sections.${current}`)}
              </h2>
            </div>
            <SectionContent key={current} id={current} />
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold tracking-tight">{t("settings.title")}</h1>
            <SectionList items={SECTIONS} status={status} variant="grouped" />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t("settings.title")}</h1>
        <label className="flex h-9 w-full max-w-70 items-center gap-2 rounded-xl border border-line bg-surface px-2.5 text-muted">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 shrink-0 fill-none stroke-current stroke-2">
            <circle cx="11" cy="11" r="6" />
            <path d="m20 20-4-4" />
          </svg>
          <span className="sr-only">{t("settings.find.label")}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setQuery("");
              }
            }}
            placeholder={t("settings.find.placeholder")}
            className="w-full min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
          />
        </label>
      </div>
      <div className="grid grid-cols-[236px_1fr] items-start gap-5">
        <SectionList items={matches} status={status} variant="rail" />
        {matches.length === 0 ? (
          <p role="status" className="rounded-2xl border border-line bg-surface p-8 text-center text-sm text-muted">
            {t("settings.find.noMatch", { query: query.trim() })}
          </p>
        ) : (
          effective && (
            <div className="min-w-0">
              <h2 className="sr-only">{t(`settings.sections.${effective}`)}</h2>
              <SectionContent key={effective} id={effective} />
            </div>
          )
        )}
      </div>
    </div>
  );
}
