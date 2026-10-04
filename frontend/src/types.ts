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

export interface SubjectSummary {
  id: number;
  display_name: string;
  color: string;
  hidden: boolean;
  aliases: string[];
  sessions: number;
  sessions_done: number;
  next_start: string | null;
  exam_start: string | null;
  exam_room: string | null;
  open_tasks: number;
  note_count: number;
}

export interface SubjectSession {
  id: number;
  start: string;
  end: string;
  room: string;
  kind: ApiEvent["kind"];
  status: ApiEvent["status"];
  section: string | null;
  note_snippet: string | null;
  note_count: number;
  open_tasks: number;
  important: boolean;
}

export interface SubjectDetail {
  subject: SubjectSummary;
  sessions: SubjectSession[];
  tasks: Task[];
}

export interface Semester {
  id: number;
  code: string;
  name: string;
  zeus_group_id: number | null;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
}

export interface ImportantNote {
  event_id: number;
  title: string;
  start: string;
  tab: NoteTab;
  body: string;
}

export interface Review {
  week_start: string;
  week_end: string;
  reviewed_at: string | null;
  overdue: Task[];
  due_this_week: Task[];
  important: ImportantNote[];
  without_notes: ApiEvent[];
  changes: ApiEvent[];
  week: ApiEvent[];
  hours: Record<"school" | "work" | "french_ext" | "other", number>;
}

export type GoogleKind = "class" | "exam" | "holiday" | "work" | "french_ext" | "other";

export interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  kinds: GoogleKind[];
  needs_reconnect: boolean;
  last_push_at: string | null;
  last_push_error: string | null;
  pending: number;
  drive_enabled: boolean;
}

export interface PushResult {
  status: "ok" | "partial" | "failed" | "skipped";
  done: number;
  failed: number;
  remaining: number;
  error: string | null;
}

export type DocumentTag = "slides" | "exercises" | "other";

export interface DocumentItem {
  id: number;
  subject_id: number;
  event_id: number | null;
  event_start: string | null;
  name: string;
  mime_type: string;
  size: number;
  tag: DocumentTag;
  web_view_link: string;
  created_at: string;
}

export interface AiStatus {
  enabled: boolean;
  model: string | null;
}

export interface AiSuggestion {
  title: string;
  due_date?: string | null;
}

export interface PendingAction {
  id: number;
  kind: "task" | "event" | "note" | "study_blocks" | (string & {});
  status: "pending" | "confirmed" | "dismissed" | "expired";
  summary: string;
  payload: Record<string, unknown>;
  expires_at: string | null;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  actions: PendingAction[];
}
