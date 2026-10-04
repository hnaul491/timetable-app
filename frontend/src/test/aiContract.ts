import type { ChatMessage, PendingAction } from "../types";

// Shapes copied from the real backend (backend/app/routers/ai.py, backend/app/ai/tools.py, schemas.py).

/** POST /api/chat answers with just the assistant message. */
export const chatSendResponse = (message: ChatMessage): { message: ChatMessage } => ({ message });

export const taskAction: PendingAction = {
  id: 11,
  kind: "task",
  status: "pending",
  summary: "Task: Revise chapter 3 (due 2026-10-22)",
  payload: { title: "Revise chapter 3", due_date: "2026-10-22", subject_id: 3, subject_name: "Relational Databases", event_id: null, summary: "Task: Revise chapter 3 (due 2026-10-22)" },
  expires_at: "2099-01-01T00:00:00Z",
};

export const eventAction: PendingAction = {
  id: 12,
  kind: "event",
  status: "pending",
  summary: "Event: Gym, 2026-10-20 18:00-19:30",
  payload: { title: "Gym", date: "2026-10-20", start: "18:00", end: "19:30", kind: "other", room: "Sports hall", summary: "Event: Gym, 2026-10-20 18:00-19:30" },
  expires_at: "2099-01-01T00:00:00Z",
};

export const noteAction: PendingAction = {
  id: 13,
  kind: "note",
  status: "pending",
  summary: "Add to the after-class note of DB: Joins and keys",
  payload: { event_id: 7, tab: "after", text: "Joins and keys\nReview <b>indexes</b>", event_title: "DB", event_date: "2026-10-19", summary: "Add to the after-class note of DB: Joins and keys" },
  expires_at: "2099-01-01T00:00:00Z",
};

export const studyBlocksAction: PendingAction = {
  id: 14,
  kind: "study_blocks",
  status: "pending",
  summary: "2 study block(s) for Relational Databases",
  payload: {
    subject_id: 3,
    subject_name: "Relational Databases",
    blocks: [
      { date: "2026-10-21", start: "18:00", end: "19:00" },
      { date: "2026-10-22", start: "17:00", end: "18:30" },
    ],
    summary: "2 study block(s) for Relational Databases",
  },
  expires_at: "2099-01-01T00:00:00Z",
};

export const expiredAction: PendingAction = { ...taskAction, id: 15, status: "expired" };
