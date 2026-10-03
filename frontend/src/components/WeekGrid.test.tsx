import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ApiEvent } from "../types";
import { WeekGrid } from "./WeekGrid";

const WEEK = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];

const event = (over: Partial<ApiEvent>): ApiEvent => ({
  id: 1, title: "French for Fall 26 T1", subject_id: 1, subject_name: "French for Fall 26 T1", color: "#0E7F72",
  section: "GR5", start: "2026-10-20T12:30:00Z", end: "2026-10-20T14:30:00Z", room: "KB605",
  kind: "class", status: "normal", source: "zeus", ...over,
});

describe("WeekGrid", () => {
  it("places an event in Paris time with an accessible label", () => {
    render(<WeekGrid days={WEEK} events={[event({})]} />);
    const block = screen.getByRole("group", { name: "French for Fall 26 T1 GR5, 14:30 to 16:30, KB605" });
    expect(block.style.top).toBe("340px");
    expect(block.style.height).toBe("100px");
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

  it("extends the grid for early classes", () => {
    render(<WeekGrid days={WEEK} events={[event({ start: "2026-10-26T07:00:00Z", end: "2026-10-26T09:00:00Z" })]} />);
    expect(screen.queryByText("07:00")).not.toBeInTheDocument();
    render(<WeekGrid days={["2026-10-26"]} events={[event({ start: "2026-10-26T06:00:00Z", end: "2026-10-26T08:00:00Z" })]} />);
    expect(screen.getByText("07:00")).toBeInTheDocument();
  });
});
