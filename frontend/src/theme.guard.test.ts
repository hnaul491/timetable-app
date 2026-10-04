import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname);
const BANNED = /\[#[0-9A-Fa-f]{3,8}\]|\b(?:bg|text|border)-(?:white|black)\b/g;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith(".tsx") && !path.endsWith(".test.tsx") ? [path] : [];
  });
}

describe("colours", () => {
  it("components use colour tokens, not hard-coded colours", () => {
    const offenders = tsxFiles(SRC).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(BANNED)].map((m) => `${file.slice(SRC.length + 1)}: ${m[0]}`),
    );
    expect(offenders).toEqual([]);
  });
});
