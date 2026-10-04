import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router";
import { AISettings } from "../components/AISettings";
import { AppearanceSettings } from "../components/AppearanceSettings";
import { BackupSettings } from "../components/BackupSettings";
import { GoogleSettings } from "../components/GoogleSettings";
import { MobileSemesterSwitch } from "../components/MobileSemesterSwitch";
import { ShortcutSettings } from "../components/ShortcutSettings";
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
    case "shortcuts":
      return <ShortcutSettings />;
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
  const location = useLocation();
  const { section } = useParams();
  const desktop = useIsDesktop();
  const status = useSettingsStatus();
  const [query, setQuery] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);

  const matches = matchSections(query, (id) => t(`settings.sections.${id}`));
  const current = isSectionId(section) ? section : null;
  const effective = current ?? (desktop ? "general" : null);
  const filteredOut = query.trim() !== "" && matches.length > 0 && effective !== null && !matches.some((s) => s.id === effective);
  const desktopRef = useRef(desktop);
  desktopRef.current = desktop;

  useEffect(() => {
    if (!desktopRef.current && current) heading.current?.focus();
  }, [current]);

  const goBack = () => {
    if ((location.state as { fromList?: boolean } | null)?.fromList) navigate(-1);
    else navigate("/settings", { replace: true });
  };

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
                onClick={(e) => {
                  e.preventDefault();
                  goBack();
                }}
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
            <h1 className="sr-only">{t("settings.title")}</h1>
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
              if (e.key === "Escape" && query !== "") {
                e.preventDefault();
                e.stopPropagation();
                setQuery("");
              } else if (e.key === "Enter" && matches.length > 0 && query.trim() !== "") {
                e.preventDefault();
                navigate(`/settings/${matches[0].id}`, { state: { fromList: true } });
              }
            }}
            placeholder={t("settings.find.placeholder")}
            className="w-full min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
          />
        </label>
      </div>
      <div className="grid grid-cols-[236px_1fr] items-start gap-5">
        <div className="sticky top-3 flex flex-col gap-2">
          <SectionList items={matches} status={status} variant="rail" />
          {matches.length === 0 && (
            <p role="status" className="px-3 text-sm text-muted">
              {t("settings.find.noMatch", { query: query.trim() })}
            </p>
          )}
          {filteredOut && (
            <p role="status" className="px-3 text-xs text-muted">
              {t("settings.find.openFirst", { title: t(`settings.sections.${matches[0].id}`) })}
            </p>
          )}
        </div>
        {effective && (
          <div className="min-w-0">
            <h2 className="sr-only">{t(`settings.sections.${effective}`)}</h2>
            <SectionContent key={effective} id={effective} />
          </div>
        )}
      </div>
    </div>
  );
}
