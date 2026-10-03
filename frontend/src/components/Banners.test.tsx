import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { MissingSectionsBanner, SyncBanner } from "./Banners";

const run = (status: "ok" | "failed" | "auth_failed") => ({
  status, started_at: "2026-10-15T04:00:00Z", finished_at: "2026-10-15T04:00:02Z",
  fetched: 0, inserted: 0, updated: 0, cancelled: 0, skipped: 0, error: status === "ok" ? null : "x",
});

const wrap = (ui: ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("banners", () => {
  it("asks for the Zeus link when never synced", () => {
    wrap(<SyncBanner status={{ last_run: null, last_success_at: null }} />);
    expect(screen.getByText(/paste your Zeus link/i)).toBeInTheDocument();
  });

  it("explains an expired Zeus link", () => {
    wrap(<SyncBanner status={{ last_run: run("auth_failed"), last_success_at: "2026-10-14T04:00:02Z" }} />);
    expect(screen.getByText(/generate a new link in Zeus/i)).toBeInTheDocument();
  });

  it("shows nothing when the last sync was ok and recent", () => {
    const { container } = wrap(
      <SyncBanner status={{ last_run: run("ok"), last_success_at: "2026-10-15T04:00:02Z" }} now={new Date("2026-10-15T10:00:00Z")} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("warns when the last successful sync is older than 36 hours", () => {
    wrap(
      <SyncBanner status={{ last_run: run("ok"), last_success_at: "2026-10-15T04:00:02Z" }} now={new Date("2026-10-17T10:00:00Z")} />,
    );
    expect(screen.getByText(/daily sync may have stopped/i)).toBeInTheDocument();
  });

  it("lists subjects that need a section", () => {
    wrap(<MissingSectionsBanner names={["French for Fall 26 T1", "Tutorat Fall 26 T1"]} />);
    expect(screen.getByText(/French for Fall 26 T1, Tutorat Fall 26 T1/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /choose your groups/i })).toHaveAttribute("href", "/settings");
  });

  it("warns about a partial sync with the reason", () => {
    wrap(
      <SyncBanner
        status={{ last_run: { ...run("ok"), status: "partial", error: "kept 15 upcoming classes that disappeared from the feed" }, last_success_at: "2026-10-15T04:00:02Z" }}
        now={new Date("2026-10-15T10:00:00Z")}
      />,
    );
    expect(screen.getByText(/kept 15 upcoming classes/)).toBeInTheDocument();
  });
});
