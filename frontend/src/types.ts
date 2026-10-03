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
  note_count: number;
  open_tasks: number;
  important: boolean;
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
  status: "running" | "ok" | "partial" | "failed" | "auth_failed";
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

export type NoteTab = "after" | "before";
export type TaskStatus = "todo" | "doing" | "done";
export type CustomKind = "work" | "french_ext" | "other";

export interface Note {
  tab: NoteTab;
  body: string;
  important: boolean;
  updated_at: string | null;
}

export interface Task {
  id: number;
  title: string;
  status: TaskStatus;
  due_date: string | null;
  important: boolean;
  source: "note" | "manual";
  note_id: number | null;
  event_id: number | null;
  subject_id: number | null;
  subject_name: string | null;
  event_start: string | null;
  position: number;
}

export interface EventDetail {
  event: ApiEvent;
  notes: Record<NoteTab, Note>;
  tasks: Task[];
  next_event_id: number | null;
  next_event_start: string | null;
  recurring_rule_id: number | null;
}

export interface RecurringRule {
  id: number;
  title: string;
  kind: CustomKind;
  weekdays: number[];
  start_time: string;
  end_time: string;
  from_date: string;
  until_date: string;
  location: string;
  occurrences: number;
}
