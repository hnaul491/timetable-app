import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { eventAction, expiredAction, noteAction, studyBlocksAction, taskAction } from "../test/aiContract";
import type { PendingAction } from "../types";
import { ActionCard } from "./ActionCard";

function show(action: PendingAction, locale: "en" | "vi" = "en") {
  const onAdd = vi.fn();
  render(
    <I18nProvider locale={locale}>
      <ActionCard action={action} busy={false} onAdd={onAdd} onDismiss={() => undefined} />
    </I18nProvider>,
  );
  return { onAdd };
}

describe("ActionCard", () => {
  it("task: title, due date and subject", () => {
    show(taskAction);
    expect(screen.getByText("Task: Revise chapter 3")).toBeInTheDocument();
    expect(screen.getByText("22 October 2026")).toBeInTheDocument();
    expect(screen.getByText("Relational Databases")).toBeInTheDocument();
  });

  it("event: date, time range, type and room", () => {
    show(eventAction);
    expect(screen.getByText("Event: Gym")).toBeInTheDocument();
    expect(screen.getByText("20 October 2026")).toBeInTheDocument();
    expect(screen.getByText("18:00–19:30")).toBeInTheDocument();
    expect(screen.getByText("My event")).toBeInTheDocument();
    expect(screen.getByText("Sports hall")).toBeInTheDocument();
  });

  it("note: class, tab and the full text as plain pre-wrapped text", () => {
    show(noteAction);
    expect(screen.getByText(/DB · 19 October 2026/)).toBeInTheDocument();
    expect(screen.getByText("after-class")).toBeInTheDocument();
    const text = screen.getByText(/Review <b>indexes<\/b>/);
    expect(text.textContent).toBe("Joins and keys\nReview <b>indexes</b>");
    expect(text).toHaveClass("whitespace-pre-wrap");
  });

  it("study blocks: subject and every block", () => {
    show(studyBlocksAction);
    expect(screen.getByText("2 study blocks for Relational Databases")).toBeInTheDocument();
    expect(screen.getByText("21 October 2026 · 18:00–19:00")).toBeInTheDocument();
    expect(screen.getByText("22 October 2026 · 17:00–18:30")).toBeInTheDocument();
  });

  it("expired, confirmed and dismissed are done: a label and no buttons", () => {
    for (const [status, label] of [["expired", "Expired"], ["confirmed", "Added"], ["dismissed", "Dismissed"]] as const) {
      const { unmount } = render(
        <I18nProvider locale="en">
          <ActionCard action={{ ...expiredAction, status }} busy={false} onAdd={() => undefined} onDismiss={() => undefined} />
        </I18nProvider>,
      );
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.queryByRole("button")).toBeNull();
      unmount();
    }
  });

  it("an unknown kind with an odd payload renders its server summary", () => {
    show({ ...taskAction, kind: "mystery", summary: "Server said so", payload: {} });
    expect(screen.getByText("Suggestion")).toBeInTheDocument();
    expect(screen.getByText("Server said so")).toBeInTheDocument();
  });

  it("summaries follow the interface language", () => {
    show(taskAction, "vi");
    expect(screen.getByText("Công việc: Revise chapter 3")).toBeInTheDocument();
  });
});
