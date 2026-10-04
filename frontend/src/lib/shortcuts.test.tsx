import { act, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatKeys, ShortcutProvider, useShortcut } from "./shortcuts";

function Probe({ n, go, save }: { n: () => void; go: () => void; save?: (e: KeyboardEvent) => void }) {
  useShortcut("new", "n", n);
  useShortcut("go", "g c", go);
  useShortcut("save", "Mod+s", (e) => save?.(e), { inDialog: true });
  return <input aria-label="field" />;
}

const setup = (save?: (e: KeyboardEvent) => void) => {
  const n = vi.fn();
  const go = vi.fn();
  render(
    <ShortcutProvider>
      <Probe n={n} go={go} save={save} />
    </ShortcutProvider>,
  );
  return { n, go };
};

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("shortcuts", () => {
  it("fires single keys and sequences", async () => {
    const user = userEvent.setup();
    const { n, go } = setup();
    await user.keyboard("n");
    expect(n).toHaveBeenCalledTimes(1);
    await user.keyboard("c");
    expect(go).not.toHaveBeenCalled();
    await user.keyboard("gc");
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("drops a sequence when the gap exceeds one second", () => {
    vi.useFakeTimers();
    const { go } = setup();
    const press = (key: string) => act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
    press("g");
    vi.advanceTimersByTime(1200);
    press("c");
    expect(go).not.toHaveBeenCalled();
    press("g");
    vi.advanceTimersByTime(500);
    press("c");
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("ignores single keys while typing", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    const { n } = setup(save);
    const input = document.querySelector("input")!;
    input.focus();
    await user.keyboard("n");
    expect(n).not.toHaveBeenCalled();
    await user.keyboard("{Control>}s{/Control}");
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].defaultPrevented).toBe(true);
  });

  it("dialogs block page shortcuts", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    const { n } = setup(save);
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    document.body.appendChild(modal);
    await user.keyboard("n");
    expect(n).not.toHaveBeenCalled();
    await user.keyboard("{Control>}s{/Control}");
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("shortcut guards", () => {
  function Keys({ n, left, help }: { n: () => void; left: () => void; help: () => void }) {
    useShortcut("n", "n", n);
    useShortcut("left", "ArrowLeft", left);
    useShortcut("help", "?", help);
    return (
      <>
        <input type="checkbox" aria-label="box" />
        <input type="text" aria-label="text" />
      </>
    );
  }
  const mount = () => {
    const fns = { n: vi.fn(), left: vi.fn(), help: vi.fn() };
    render(
      <ShortcutProvider>
        <Keys {...fns} />
      </ShortcutProvider>,
    );
    return fns;
  };
  const press = (init: KeyboardEventInit, target: Element | Window = window) =>
    act(() => void target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init })));

  it("a focused checkbox is not typing", async () => {
    const { n } = mount();
    const box = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    box.focus();
    press({ key: "n" }, box);
    expect(n).toHaveBeenCalledTimes(1);
    const text = document.querySelector<HTMLInputElement>('input[type="text"]')!;
    text.focus();
    press({ key: "n" }, text);
    expect(n).toHaveBeenCalledTimes(1);
  });

  it("held letters do not repeat but arrows do", () => {
    const { n, left } = mount();
    press({ key: "n", repeat: true });
    expect(n).not.toHaveBeenCalled();
    press({ key: "ArrowLeft", repeat: true });
    expect(left).toHaveBeenCalledTimes(1);
  });

  it("Shift with a letter or arrow does not fire, but ? still does", () => {
    const { n, left, help } = mount();
    press({ key: "N", shiftKey: true });
    press({ key: "ArrowLeft", shiftKey: true });
    expect(n).not.toHaveBeenCalled();
    expect(left).not.toHaveBeenCalled();
    press({ key: "?", shiftKey: true });
    expect(help).toHaveBeenCalledTimes(1);
  });
});

describe("formatKeys", () => {
  it("formats modifiers and sequences", () => {
    expect(formatKeys("Mod+s", false)).toEqual(["Ctrl", "S"]);
    expect(formatKeys("Mod+s", true)).toEqual(["⌘", "S"]);
    expect(formatKeys("g c")).toEqual(["G", "C"]);
  });
});
