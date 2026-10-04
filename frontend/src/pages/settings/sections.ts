import type { MessageKey } from "../../i18n";

export const SECTION_IDS = ["general", "school", "subjects", "google", "ai", "backup", "shortcuts"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export function isSectionId(value: string | undefined): value is SectionId {
  return (SECTION_IDS as readonly string[]).includes(value ?? "");
}

export interface SectionDef {
  id: SectionId;
  title: MessageKey;
  /** English and Vietnamese search words, matched without accents. */
  keywords: string;
}

export const SECTIONS: SectionDef[] = [
  { id: "general", title: "settings.sections.general", keywords: "theme dark light language english vietnamese appearance giao dien ngon ngu tieng viet sang toi" },
  { id: "school", title: "settings.sections.school", keywords: "zeus link sync semester group td tp section repeating recurring ics lien ket dong bo hoc ky nhom lap lai" },
  { id: "subjects", title: "settings.sections.subjects", keywords: "subject colour color rename merge hide alias mon hoc mau doi ten gop an" },
  { id: "google", title: "settings.sections.google", keywords: "google calendar drive documents connect reconnect disconnect lich tai lieu ket noi" },
  { id: "ai", title: "settings.sections.ai", keywords: "ai assistant gemini model limit fallback tro ly mo hinh gioi han" },
  { id: "backup", title: "settings.sections.backup", keywords: "backup export download drive json restore sao luu xuat tai xuong" },
  { id: "shortcuts", title: "settings.sections.shortcuts", keywords: "shortcut shortcuts keyboard key keys hotkey phim tat ban phim" },
];

export const stripAccents = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

/** Sections whose title or keywords contain every word typed (accent-insensitive). */
export function matchSections(query: string, titleOf: (id: SectionId) => string): SectionDef[] {
  const words = stripAccents(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return SECTIONS;
  return SECTIONS.filter((s) => {
    const hay = stripAccents(`${titleOf(s.id)} ${s.keywords}`);
    return words.every((w) => hay.includes(w));
  });
}
