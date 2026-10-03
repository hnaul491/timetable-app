export interface ApiEvent {
  id: number;
  title: string;
  subject_id: number | null;
  subject_name: string | null;
  color: string | null;
  section: string | null;
  start: string;
  end: string;
  room: string;
  kind: "class" | "exam" | "holiday" | "work" | "french_ext" | "other";
  status: "normal" | "changed" | "cancelled";
  source: "zeus" | "custom";
}

export interface EventsResponse {
  events: ApiEvent[];
  missing_sections: string[];
}

export interface SectionChoice {
  subject_id: number;
  subject_name: string;
  sections: string[];
  chosen: string | null;
}

export interface SyncRun {
  status: "running" | "ok" | "failed" | "auth_failed";
  started_at: string;
  finished_at: string | null;
  fetched: number;
  inserted: number;
  updated: number;
  cancelled: number;
  skipped: number;
  error: string | null;
}

export interface SyncStatus {
  last_run: SyncRun | null;
  last_success_at: string | null;
}
