import { useLocale, useT } from "../i18n";
import type { Locale } from "../i18n/locale";
import { useSetLanguage } from "../i18n/LanguageRoot";
import { useTheme, type ThemeChoice } from "../lib/theme";

const THEMES: ThemeChoice[] = ["system", "light", "dark"];

export function AppearanceSettings() {
  const t = useT();
  const locale = useLocale();
  const setLanguage = useSetLanguage();
  const [theme, setTheme] = useTheme();
  return (
    <section aria-labelledby="appearance-heading" className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
      <h3 id="appearance-heading" className="text-base font-bold">
        {t("settings.appearance.title")}
      </h3>
      <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">
        {t("settings.appearance.language")}
        <select
          value={locale}
          onChange={(e) => setLanguage.mutate(e.target.value as Locale)}
          disabled={setLanguage.isPending}
          className="h-10 w-56 rounded-xl border border-line-strong bg-surface px-3 text-sm text-ink"
        >
          <option value="en">English</option>
          <option value="vi">Tiếng Việt</option>
        </select>
      </label>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-semibold text-ink-2">{t("settings.appearance.theme")}</legend>
        <div className="flex flex-wrap gap-2">
          {THEMES.map((choice) => (
            <label key={choice} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm">
              <input type="radio" name="theme" value={choice} checked={theme === choice} onChange={() => setTheme(choice)} />
              {t(`settings.appearance.themes.${choice}`)}
            </label>
          ))}
        </div>
      </fieldset>
      {setLanguage.error && <p className="text-sm text-danger">{(setLanguage.error as Error).message}</p>}
    </section>
  );
}
