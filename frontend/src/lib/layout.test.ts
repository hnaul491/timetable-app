import { describe, expect, it } from "vitest";
import { layoutDay } from "./layout";

const ev = (id: string, startMin: number, endMin: number) => ({ id, startMin, endMin });
const byId = (placed: ReturnType<typeof layoutDay<ReturnType<typeof ev>>>) =>
  Object.fromEntries(placed.map((p) => [p.item.id, [p.column, p.columns]]));

describe("layoutDay", () => {
  it("separate events each get the full width", () => {
    expect(byId(layoutDay([ev("a", 540, 600), ev("b", 660, 720)]))).toEqual({ a: [0, 1], b: [0, 1] });
  });

  it("touching events do not overlap", () => {
    expect(byId(layoutDay([ev("tutorat", 810, 870), ev("french", 870, 990)]))).toEqual({ tutorat: [0, 1], french: [0, 1] });
  });

  it("two overlapping events share the width", () => {
    expect(byId(layoutDay([ev("a", 870, 990), ev("b", 870, 990)]))).toEqual({ a: [0, 2], b: [1, 2] });
  });

  it("a chain reuses free columns", () => {
    expect(byId(layoutDay([ev("a", 540, 660), ev("b", 600, 720), ev("c", 660, 780)]))).toEqual({
      a: [0, 2],
      b: [1, 2],
      c: [0, 2],
    });
  });
});
