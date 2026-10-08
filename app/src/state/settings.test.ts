import { describe, expect, it } from "vitest";
import { DEFAULT_PLAYBOOK, migrateSettings } from "./settings";

describe("migrateSettings v1 → v2", () => {
  it("turns inputMode into audibleStyle", () => {
    expect(migrateSettings({ inputMode: "ps" }, 1)).toMatchObject({ audibleStyle: "ps" });
    expect(migrateSettings({ inputMode: "keyboard" }, 1)).toMatchObject({ audibleStyle: "keyboard" });
    expect(migrateSettings({ inputMode: "xbox" }, 1)).toMatchObject({ audibleStyle: "xbox" });
    expect(migrateSettings({ inputMode: "auto" }, 1)).toMatchObject({ audibleStyle: "xbox" });
    expect(migrateSettings({}, 1)).toMatchObject({ audibleStyle: "xbox" });
    expect("inputMode" in migrateSettings({ inputMode: "ps" }, 1)).toBe(false);
  });

  it("keeps everything else", () => {
    const out = migrateSettings({ inputMode: "auto", assetPrefix: "XY_", favorites: ["a"], audibleButtons: { 1: "A", 2: "X", 3: "Y", 4: "B" }, extra: 1 }, 1);
    expect(out).toMatchObject({ assetPrefix: "XY_", favorites: ["a"], audibleButtons: { 1: "A", 2: "X", 3: "Y", 4: "B" }, extra: 1 });
  });

  it("opens STUDIO by default instead of STUDIOLIB, but keeps another remembered book", () => {
    expect(migrateSettings({}, 1).lastPlaybook).toBe(DEFAULT_PLAYBOOK);
    expect(migrateSettings({ lastPlaybook: "playbooks/studio-lib.json" }, 1).lastPlaybook).toBe("playbooks/FUSION.json");
    expect(migrateSettings({ lastPlaybook: "playbooks/my-book.json" }, 1).lastPlaybook).toBe("playbooks/my-book.json");
  });

  it("leaves v2 state alone and survives garbage", () => {
    expect(migrateSettings({ audibleStyle: "ps", lastPlaybook: "playbooks/studio-lib.json" }, 3)).toEqual({ audibleStyle: "ps", lastPlaybook: "playbooks/studio-lib.json" });
    expect(migrateSettings({ cardColumns: 6 }, 2).cardColumns).toBe(3);
    expect(migrateSettings({ cardColumns: 9 }, 3).cardColumns).toBe(9);
    expect(migrateSettings(null, 0)).toMatchObject({ audibleStyle: "xbox", lastPlaybook: DEFAULT_PLAYBOOK });
  });
});
