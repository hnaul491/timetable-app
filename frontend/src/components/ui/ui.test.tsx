import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider, useConfirm } from "./Confirm";
import { Dialog } from "./Dialog";
import { ToastProvider, useToast } from "./Toast";
import { TopProgress } from "./TopProgress";

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Edit">
        <button type="button">First</button>
        <button type="button">Last</button>
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  it("traps focus, closes on Escape and returns focus", async () => {
    render(<DialogHarness />);
    const opener = screen.getByRole("button", { name: "Open" });
    await userEvent.click(opener);
    expect(screen.getByRole("dialog", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab(); // past "Last" wraps around inside the dialog
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});

function ConfirmHarness({ onResult }: { onResult: (v: boolean) => void }) {
  const confirm = useConfirm();
  return (
    <button type="button" onClick={async () => onResult(await confirm({ title: "Delete class?", confirmLabel: "Delete", tone: "danger" }))}>
      Ask
    </button>
  );
}

describe("Confirm", () => {
  it("resolves true on confirm and false on cancel", async () => {
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <ConfirmHarness onResult={onResult} />
      </ConfirmProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onResult).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onResult).toHaveBeenLastCalledWith(false);
  });
});

function ToastHarness({ retry }: { retry: () => void }) {
  const toast = useToast();
  return (
    <>
      <button type="button" onClick={() => toast.success("Saved")}>Ok</button>
      <button type="button" onClick={() => toast.error("Couldn't save", { retry })}>Fail</button>
    </>
  );
}

describe("Toasts", () => {
  afterEach(() => vi.useRealTimers());

  it("success hides after 4 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <ToastProvider>
        <ToastHarness retry={() => {}} />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Ok" }));
    expect(screen.getByText("Saved")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(4100));
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("error toast retries", async () => {
    const retry = vi.fn();
    render(
      <ToastProvider>
        <ToastHarness retry={retry} />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Fail" }));
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalled();
    expect(screen.queryByText("Couldn't save")).not.toBeInTheDocument();
  });
});

describe("TopProgress", () => {
  it("shows while a query is loading", async () => {
    let resolve: (v: number) => void = () => {};
    function Loader() {
      useQuery({ queryKey: ["slow"], queryFn: () => new Promise<number>((r) => (resolve = r)) });
      return null;
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TopProgress />
        <Loader />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("top-progress")).toHaveAttribute("data-busy", "true"));
    await act(async () => resolve(1));
    await waitFor(() => expect(screen.getByTestId("top-progress")).toHaveAttribute("data-busy", "false"));
  });
});
