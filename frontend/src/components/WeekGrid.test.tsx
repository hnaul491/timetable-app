import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ApiEvent } from "../types";
import { WeekGrid } from "./WeekGrid";

const WEEK = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];

const event = (over: Partial<ApiEvent>): ApiEvent => ({
  id: 1, title: "French for Fall 26 T1", subject_id: 1, subject_name: "French for Fall 26 T1", color: "#0E7F72",
  section: "GR5", start: "2026-10-20T12:30:00Z", end: "2026-10-20T14:30:00Z", room: "KB605",
  kind: "class", status: "normal", source: "zeus",
  note_count: 0, open_tasks: 0, important: false, ...over,
});

describe("WeekGrid", () => {
  it("places an event in Paris time with an accessible label", () => {
    render(<WeekGrid days={WEEK} events={[event({})]} />);
    const block = screen.getByRole("group", { name: "French for Fall 26 T1 GR5, 14:30 to 16:30, KB605" });
    expect(block.style.top).toBe("340px");
    expect(block.style.height).toBe("100px");
  });

  it("shows work shifts in the themed work colour with a visible border", () => {
    render(<WeekGrid days={WEEK} events={[event({ kind: "work", color: null })]} />);
    const block = screen.getByRole("group");
    expect(block.style.border).toContain("var(--tt-kind-work)");
    expect(block.style.background).toContain("var(--tt-kind-work)");
  });

  it("renders overlapping events side by side", () => {
    render(<WeekGrid days={WEEK} events={[event({ id: 1 }), event({ id: 2, title: "Other", section: null })]} />);
    const blocks = screen.getAllByRole("group");
    expect(blocks.map((b) => [b.dataset.column, b.dataset.columns])).toEqual([["0", "2"], ["1", "2"]]);
  });

  it("strikes through cancelled events and badges changed ones", () => {
    render(<WeekGrid days={WEEK} events={[event({ id: 1, status: "cancelled" }), event({ id: 2, start: "2026-10-21T07:00:00Z", end: "2026-10-21T09:00:00Z", status: "changed" })]} />);
    expect(screen.getAllByRole("group")[0]).toHaveClass("line-through");
    expect(screen.getByText("Changed")).toBeInTheDocument();
  });

  it("shows holidays as a header chip, not a block", () => {
    render(<WeekGrid days={WEEK} events={[event({ title: "Vacances", kind: "holiday", subject_id: null, section: null, start: "2026-10-19T06:00:00Z", end: "2026-10-19T18:00:00Z" })]} />);
    expect(screen.getByText("Vacances")).toBeInTheDocument();
    expect(screen.queryAllByRole("group")).toHaveLength(0);
  });

  it("shows a multi-day holiday on every day it covers, end exclusive at midnight", () => {
    // Sat 24 Oct 00:00 Paris (22:00Z) to Tue 27 Oct 00:00 Paris (23:00Z): covers 24, 25, 26.
    const holiday = event({ id: 9, title: "Toussaint", kind: "holiday", subject_id: null, section: null, start: "2026-10-23T22:00:00Z", end: "2026-10-26T23:00:00Z" });
    const { unmount } = render(<WeekGrid days={WEEK} events={[holiday]} />);
    expect(screen.getAllByText("Toussaint")).toHaveLength(2);
    unmount();
    const nextWeek = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"];
    render(<WeekGrid days={nextWeek} events={[holiday]} />);
    expect(screen.getAllByText("Toussaint")).toHaveLength(1);
  });

  it("extends the grid for early classes", () => {
    render(<WeekGrid days={WEEK} events={[event({ start: "2026-10-26T07:00:00Z", end: "2026-10-26T09:00:00Z" })]} />);
    expect(screen.queryByText("07:00")).not.toBeInTheDocument();
    render(<WeekGrid days={["2026-10-26"]} events={[event({ start: "2026-10-26T06:00:00Z", end: "2026-10-26T08:00:00Z" })]} />);
    expect(screen.getByText("07:00")).toBeInTheDocument();
  });

  it("opens an event when onSelect is given", async () => {
    const onSelect = vi.fn();
    render(<WeekGrid days={WEEK} events={[event({ id: 42 })]} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: "Open French for Fall 26 T1 GR5" }));
    expect(onSelect).toHaveBeenCalledWith(42);
  });

  it("reports empty-slot clicks rounded down to 30 minutes, but not clicks on an event", async () => {
    const onCreateAt = vi.fn();
    const { container } = render(<WeekGrid days={WEEK} events={[event({ id: 42 })]} onSelect={() => {}} onCreateAt={onCreateAt} />);
    const column = container.querySelector<HTMLElement>('[data-date="2026-10-21"]')!;
    column.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} });
    fireEvent.click(column, { clientY: 52 + 30 }); // 08:00 + 1h + 37 min -> 09:30
    expect(onCreateAt).toHaveBeenCalledWith("2026-10-21", 9 * 60 + 30);
    await userEvent.click(screen.getByRole("button", { name: "Open French for Fall 26 T1 GR5" }));
    expect(onCreateAt).toHaveBeenCalledTimes(1);
  });

  it("shows note, task and important badges", () => {
    render(<WeekGrid days={WEEK} events={[event({ note_count: 1, open_tasks: 2, important: true })]} />);
    expect(screen.getByText("Note")).toBeInTheDocument();
    expect(screen.getByText("2 tasks")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Important" })).toBeInTheDocument();
  });

  it("marks external French with a dashed outline", () => {
    render(<WeekGrid days={WEEK} events={[event({ title: "French (external)", kind: "french_ext", color: null, section: null, subject_id: null })]} />);
    expect(screen.getByRole("group").dataset.kind).toBe("french_ext");
  });

  it("draws an event that ends on a later Paris day on each day it covers", async () => {
    const onSelect = vi.fn();
    // Mon 19 Oct 22:00 Paris (20:00Z) to Tue 20 Oct 02:00 Paris (00:00Z)
    render(<WeekGrid days={WEEK} events={[event({ id: 9, title: "Night shift", section: null, room: null, kind: "work", color: null, start: "2026-10-19T20:00:00Z", end: "2026-10-20T00:00:00Z" })]} onSelect={onSelect} />);
    const blocks = screen.getAllByRole("group", { name: /Night shift/ });
    expect(blocks).toHaveLength(2);
    const [first, second] = blocks;
    expect(first.closest("[data-date]")).toHaveAttribute("data-date", "2026-10-19");
    expect(second.closest("[data-date]")).toHaveAttribute("data-date", "2026-10-20");
    // the grid grows to 00:00-24:00 bounds as needed; first part: 22:00 to 24:00, second: 00:00 to 02:00
    expect(first.style.height).toBe(`${2 * 52 - 4}px`);
    expect(second.style.height).toBe(`${2 * 52 - 4}px`);
    for (const b of blocks) await userEvent.click(b.querySelector("button")!);
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenNthCalledWith(1, 9);
    expect(onSelect).toHaveBeenNthCalledWith(2, 9);
  });

  it("does not add a day when the event ends exactly at midnight", () => {
    render(<WeekGrid days={WEEK} events={[event({ id: 9, title: "Late", section: null, room: null, start: "2026-10-19T20:00:00Z", end: "2026-10-19T22:00:00Z" })]} />);
    expect(screen.getAllByRole("group", { name: /Late/ })).toHaveLength(1);
  });
});
