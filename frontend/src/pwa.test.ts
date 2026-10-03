import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(root, p));

function pngSize(buf: Buffer): [number, number] {
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

describe("installable app", () => {
  it("has a complete web manifest", () => {
    const manifest = JSON.parse(read("public/manifest.webmanifest").toString());
    expect(manifest).toMatchObject({ name: "Timetable", short_name: "Timetable", start_url: "/", display: "standalone", theme_color: "#2E55E6", background_color: "#F4F5F7" });
    expect(manifest.icons).toEqual([
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
    ]);
  });

  it("ships real PNG icons of the right sizes", () => {
    expect(pngSize(read("public/icons/icon-192.png"))).toEqual([192, 192]);
    expect(pngSize(read("public/icons/icon-512.png"))).toEqual([512, 512]);
    expect(pngSize(read("public/icons/apple-touch-icon.png"))).toEqual([180, 180]);
  });

  it("links the manifest from index.html", () => {
    const html = read("index.html").toString();
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
  });
});
