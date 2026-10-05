import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseJson, serializeDoc } from "./json";
import type { DocKind } from "./types";
import type { ExportSummary, SaveSummary } from "./exportSummary";
import { buildExportZip, bundleEntries, bundleFileName, bundleReadme, isBundlePath, type BundleDoc } from "./zip";

const read = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), "utf8");
const doc = (path: string, kind: DocKind, extra: Partial<BundleDoc> = {}): BundleDoc => ({ path, kind, data: parseJson(read(path)), ...extra });

describe("export bundle zip", () => {
  const date = new Date(2026, 9, 4, 15, 30);
  const docs: BundleDoc[] = [
    doc("playbooks/studio-test.json", "playbook"),
    doc("playbooks/plays/pbs-ytrips-v1.json", "plays", { dirty: true }),
    { path: "app-data/concepts.json", kind: "concepts", data: { version: 1, categories: [], tags: {} } },
    { path: "playbooks/zz-broken.json", kind: "playbook", data: null, error: "Invalid JSON", savedText: "{ nope" },
    { path: "playbooks/zz-unreadable.json", kind: "playbook", data: null, error: "Can't read", savedText: "" },
    { path: "playbooks/mod.json", kind: "playbook", data: {} },
    { path: "app-data/.trash/x.json", kind: "appdata", data: {} },
  ];

  it("round-trips the current docs through unzipSync", () => {
    const zip = buildExportZip(docs, { date });
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual([
      "README.txt",
      "app-data/concepts.json",
      "playbooks/plays/pbs-ytrips-v1.json",
      "playbooks/studio-test.json",
      "playbooks/zz-broken.json",
    ]);
    const text = strFromU8(files["playbooks/studio-test.json"]);
    expect(text).toBe(serializeDoc("playbook", docs[0].data));
    expect(JSON.parse(text)).toEqual(JSON.parse(read("playbooks/studio-test.json")));
    expect(JSON.parse(strFromU8(files["playbooks/plays/pbs-ytrips-v1.json"]))).toEqual(JSON.parse(read("playbooks/plays/pbs-ytrips-v1.json")));
    expect(strFromU8(files["playbooks/zz-broken.json"])).toBe("{ nope");
  });

  it("explains the game-PC steps in README.txt", () => {
    const readme = strFromU8(unzipSync(buildExportZip(docs, { date }))["README.txt"]);
    expect(readme).toContain("powershell -ExecutionPolicy Bypass -File tools\\export.ps1 -Install");
    expect(readme).toContain("mods\\pbstudio.fbmod");
    expect(readme).toContain("PBOOKOFF-<NAME>");
    expect(readme).toContain("Frosty");
    expect(readme).toContain("2026-10-04 15:30");
    expect(readme).toMatch(/pbs-ytrips-v1\.json {3}\(has edits not yet saved/);
  });

  it("lists why a save would fail and what the mod builds from playbooks/sets/", () => {
    const save = {
      file: "playbooks/a.json",
      saveName: "PBOOKOFF-A",
      plays: 1,
      sets: 1,
      formations: 1,
      templateSections: ["Strong I"],
      willFail: true,
      failures: ['"Strong I" (formId 4) has no sets in the template, so "template" would drop it'],
    } as unknown as SaveSummary;
    const summary = {
      saves: [save],
      customPlays: [{}],
      customFormations: [{ name: "Gun PBS", base: "x/Shotgun", baseName: "Shotgun" }],
      customSets: [{ name: "Trips Open", formationName: "Gun PBS", clones: 3 }],
      clonedPlays: [{}, {}, {}],
      setsFiles: ["playbooks/sets/s.json"],
      playsFiles: ["playbooks/plays/p.json"],
      pulled: [],
      notes: [],
    } as unknown as ExportSummary;
    const readme = bundleReadme(bundleEntries(docs), { date, summary });
    expect(readme).toContain("[WILL FAIL");
    expect(readme).toContain('FAILS: "Strong I" (formId 4) has no sets in the template');
    expect(readme).not.toContain("MISSING");
    expect(readme).not.toMatch(/not built yet|planned/);
    expect(readme).toContain("mods/pbstudio.fbmod: 1 custom formation, 1 custom set, 3 cloned plays from 1 sets file; 1 custom play from 1 plays file, 0 library plays pulled in");
    expect(readme).toContain("formation GUN PBS (new, from SHOTGUN)");
    expect(readme).toContain("set GUN PBS / TRIPS OPEN - 3 cloned plays");
    expect(readme).toContain("playbooks\\sets\\*.json (custom formations, sets and the plays cloned into them)");
  });

  it("selects bundle paths", () => {
    expect(isBundlePath("playbooks/a.json")).toBe(true);
    expect(isBundlePath("playbooks/plays/a.json")).toBe(true);
    expect(isBundlePath("playbooks/sets/a.json")).toBe(true);
    expect(isBundlePath("app-data/notes.json")).toBe(true);
    expect(isBundlePath("playbooks/mod.json")).toBe(false);
    expect(isBundlePath("app-data/.trash/x.json")).toBe(false);
    expect(isBundlePath("data/library/plays.json")).toBe(false);
    expect(bundleEntries(docs).map((e) => e.source)).toEqual(["serialized", "serialized", "serialized", "raw"]);
    expect(bundleFileName(date)).toBe("pbstudio-export-20261004-1530.zip");
  });
});
