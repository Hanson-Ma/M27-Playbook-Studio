import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalConcepts,
  canonicalPlaybook,
  canonicalPlaysFile,
  canonicalSetsFile,
  formatJson,
  parseJson,
  serializeDoc,
} from "./json";
import { SITUATION_ORDER } from "./situations";
import type { ConceptsDoc, DocKind, PlaybookSpec, PlaysFile, SetsFile } from "./types";

const REPO = path.resolve(import.meta.dirname, "../../..");

function walkJson(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return walkJson(p);
    return n.endsWith(".json") ? [p] : [];
  });
}

function kindOf(rel: string): DocKind {
  if (rel.startsWith("playbooks/plays/")) return "plays";
  if (rel.startsWith("playbooks/sets/")) return "sets";
  if (rel === "app-data/concepts.json") return "concepts";
  if (/^playbooks\/[^/]+\.json$/.test(rel) && rel !== "playbooks/mod.json") return "playbook";
  return "appdata";
}

describe("parseJson", () => {
  it("strips a BOM", () => {
    expect(parseJson('﻿{ "a": 1 }')).toEqual({ a: 1 });
  });
});

describe("formatJson", () => {
  it("prints small containers on one line with the house spacing", () => {
    expect(formatJson({ play: "Inside Zone", audible: 2 })).toBe('{ "play": "Inside Zone", "audible": 2 }\n');
    expect(formatJson({ a: 1, b: [1, 2] })).toBe('{ "a": 1, "b": [1, 2] }\n');
    expect(formatJson([])).toBe("[]\n");
    expect(formatJson({})).toBe("{}\n");
    expect(formatJson({ a: {}, b: [] })).toBe('{ "a": {}, "b": [] }\n');
  });

  it("breaks containers that don't fit, one member per line, 2-space indent", () => {
    const v = { name: "x".repeat(60), list: [{ a: 1 }, { b: "y".repeat(40) }] };
    expect(formatJson(v, { width: 60 })).toBe(
      [
        "{",
        `  "name": "${"x".repeat(60)}",`,
        '  "list": [',
        '    { "a": 1 },',
        `    { "b": "${"y".repeat(40)}" }`, // 55 columns: fits
        "  ]",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("respects the width exactly, counting the key prefix and trailing comma", () => {
    const inner = { k: "v".repeat(10) }; // { "k": "vvvvvvvvvv" } = 21 chars
    // `  "a": ` (7) + 21 + "," (1) = 29
    expect(formatJson({ a: inner, b: 1 }, { width: 29 }).split("\n")[1]).toBe(`  "a": { "k": "${"v".repeat(10)}" },`);
    expect(formatJson({ a: inner, b: 1 }, { width: 28 }).split("\n")[1]).toBe(`  "a": {`);
    // the whole document on one line needs exactly its own length
    const one = `{ "a": { "k": "${"v".repeat(10)}" }, "b": 1 }`;
    expect(formatJson({ a: inner, b: 1 }, { width: one.length })).toBe(one + "\n");
    expect(formatJson({ a: inner, b: 1 }, { width: one.length - 1 })).not.toBe(one + "\n");
  });

  it("prints scalars like JSON.stringify", () => {
    const v = [0.1, -0, 1e21, 1.5e-7, NaN, Infinity, "é\n\"q\" ", true, null, 123456789012];
    expect(formatJson(v)).toBe(JSON.stringify(v).replace(/,/g, ", ") + "\n");
  });

  it("drops what JSON.stringify drops and honors toJSON", () => {
    const v = { a: undefined, b: () => 1, c: [undefined, 1], d: new Date(0), e: 2 };
    expect(JSON.parse(formatJson(v))).toEqual(JSON.parse(JSON.stringify(v)));
    expect(formatJson(undefined)).toBe("null\n");
  });

  it("keeps a long scalar on its line instead of failing", () => {
    const s = "z".repeat(200);
    expect(formatJson({ s })).toBe(`{\n  "s": "${s}"\n}\n`);
  });

  it("round-trips real library data", () => {
    for (const name of ["formations", "enums"]) {
      const file = path.join(REPO, "data/library", `${name}.json`);
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue; // library not present on this machine
      }
      const v = parseJson(text);
      const out = formatJson(v);
      expect(JSON.parse(out)).toEqual(v);
      // only a lone long scalar may overflow the width
      const lone = /^\s*("(?:[^"\\]|\\.)*": )?("(?:[^"\\]|\\.)*"|[-+\d.eE]+|true|false|null),?$/;
      expect(out.split("\n").filter((l) => l.length > 110 && !lone.test(l))).toEqual([]);
    }
  });
});

describe("serializeDoc on the repo's example files", () => {
  const files = walkJson(path.join(REPO, "playbooks"));

  it("finds the examples", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  for (const file of files) {
    const rel = path.relative(REPO, file).split(path.sep).join("/");
    it(`round-trips ${rel}`, () => {
      const original = parseJson(readFileSync(file, "utf8"));
      const kind = kindOf(rel);
      const text = serializeDoc(kind, original);
      expect(text.endsWith("\n")).toBe(true);
      expect(parseJson(text)).toEqual(original);
      // idempotent: saving what we wrote changes nothing
      expect(serializeDoc(kind, parseJson(text))).toBe(text);
      // canonicalization never drops or invents keys at any depth
      expect(keyPaths(parseJson(text))).toEqual(keyPaths(original));
    });
  }
});

/** Every key path in a value, sorted (order-insensitive). */
function keyPaths(v: unknown, at = ""): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => keyPaths(x, `${at}/${i}`));
  if (v && typeof v === "object")
    return Object.keys(v)
      .flatMap((k) => [`${at}/${k}`, ...keyPaths((v as Record<string, unknown>)[k], `${at}/${k}`)])
      .sort();
  return [];
}

describe("canonical key order", () => {
  it("orders a playbook: known scalars, unknown, formations last; entries in contract order", () => {
    const spec = {
      formations: [
        {
          collapsed: true,
          sets: [
            {
              plays: [
                { zzz: 1, cpu: { LastPlay: 5, FirstDown: 40, custom: 1, "3rdAndShort": 30 }, audible: 2, play: "Inside Zone" },
                { play: "Mesh" },
              ],
              set: "Y Trips Wk",
            },
          ],
          formation: "Shotgun",
        },
        { sets: "template", formation: "Special" },
      ],
      version: 2,
      notes: "n",
      side: "offense",
      name: "STUDIO",
    } as unknown as PlaybookSpec;
    const c = canonicalPlaybook(spec);
    expect(Object.keys(c)).toEqual(["name", "side", "notes", "version", "formations"]);
    const f = c.formations[0];
    expect(Object.keys(f)).toEqual(["formation", "sets", "collapsed"]);
    const s = (f.sets as unknown as Record<string, unknown>[])[0];
    expect(Object.keys(s)).toEqual(["set", "plays"]);
    const p = (s.plays as Record<string, unknown>[])[0];
    expect(Object.keys(p)).toEqual(["play", "audible", "cpu", "zzz"]);
    expect(Object.keys(p.cpu as object)).toEqual(["FirstDown", "3rdAndShort", "LastPlay", "custom"]);
    expect(c.formations[1]).toEqual({ formation: "Special", sets: "template" });
    expect(Object.keys(c.formations[1])).toEqual(["formation", "sets"]);
    // the input is not mutated
    expect(Object.keys(spec)[0]).toBe("formations");
  });

  it("orders cpu keys exactly by SITUATION_ORDER", () => {
    const cpu = Object.fromEntries([...SITUATION_ORDER].reverse().map((k, i) => [k, i]));
    const c = canonicalPlaybook({
      name: "X",
      side: "offense",
      formations: [{ formation: "F", sets: [{ set: "S", plays: [{ play: "P", cpu }] }] }],
    });
    const entry = (c.formations[0].sets as { plays: { cpu: object }[] }[])[0].plays[0];
    expect(Object.keys(entry.cpu)).toEqual(SITUATION_ORDER);
  });

  it("orders a plays file: unknown top-level keys first, plays last; specs, players and steps", () => {
    const step = { speed: 100, type: "RunRoute", direction: 90, distance: 7 };
    const f = {
      plays: [
        {
          reads: [{ pct: 0.8, pos: 5 }],
          players: {
            "3": "RunRoute/WR_Run90for30",
            "2": { steps: [step], keep: 0, extra: "x", template: "RunRoute/T", routeType: "R", new: "PBS_A" },
          },
          vip: 2,
          mystery: [1],
          base: "football/x/Base",
          name: "PBS A",
          asset: "PBS_A",
          runHole: 4,
          blocking: "BTCounter",
          playType: "OffensePlayType_RunCounter",
        },
      ],
      brtRef: { Play: "p" },
      title: "t",
    } as unknown as PlaysFile;
    const c = canonicalPlaysFile(f);
    expect(Object.keys(c)).toEqual(["brtRef", "title", "plays"]);
    const p = c.plays[0];
    expect(Object.keys(p)).toEqual(["name", "asset", "base", "playType", "blocking", "runHole", "vip", "players", "reads", "mystery"]);
    const authored = p.players!["2"] as Record<string, unknown>;
    expect(Object.keys(authored)).toEqual(["new", "routeType", "template", "keep", "steps", "extra"]);
    // steps and reads keep their own key order
    expect(Object.keys((authored.steps as object[])[0])).toEqual(["speed", "type", "direction", "distance"]);
    expect(Object.keys(p.reads![0])).toEqual(["pct", "pos"]);
    expect(p.players!["3"]).toBe("RunRoute/WR_Run90for30");
  });

  it("orders a sets file", () => {
    const f = {
      formations: [{ base: "B", asset: "A", name: "N", x: 1 }],
      sets: [
        {
          plays: [{ asset: "a", name: "n", from: "f" }],
          movements: { M1left: [{ y: -2, x: 3, slot: 4 }] },
          positions: [{ facing: 90, stance: "s", y: -1, x: 7, slot: 2, q: 1 }],
          formation: "F",
          base: "B",
          asset: "A",
          name: "N",
        },
      ],
      notes: "hi",
    } as unknown as SetsFile;
    const c = canonicalSetsFile(f);
    expect(Object.keys(c)).toEqual(["notes", "sets", "formations"]);
    const s = c.sets[0];
    expect(Object.keys(s)).toEqual(["name", "asset", "base", "formation", "positions", "movements", "plays"]);
    expect(Object.keys(s.positions![0])).toEqual(["slot", "x", "y", "stance", "facing", "q"]);
    expect(Object.keys(s.movements!.M1left[0])).toEqual(["slot", "x", "y"]);
    expect(Object.keys(s.plays![0])).toEqual(["from", "name", "asset"]);
    expect(Object.keys(c.formations![0])).toEqual(["name", "asset", "base", "x"]);
  });

  it("orders a concepts doc and sorts the PlayKey maps", () => {
    const d = {
      notes: { b: "2", a: "1" },
      tags: { "z/Play": ["mesh"], "a/Play": ["snag"] },
      categories: [{ color: "#fff", group: "pass", name: "Mesh", id: "mesh", extra: 1 }],
      custom: true,
      version: 1,
    } as unknown as ConceptsDoc;
    const c = canonicalConcepts(d);
    expect(Object.keys(c)).toEqual(["version", "custom", "categories", "tags", "notes"]);
    expect(Object.keys(c.categories[0])).toEqual(["id", "name", "group", "color", "extra"]);
    expect(Object.keys(c.tags)).toEqual(["a/Play", "z/Play"]);
    expect(Object.keys(c.notes!)).toEqual(["a", "b"]);
  });

  it("keeps an own __proto__ key and tolerates malformed shapes", () => {
    const v = parseJson<PlaybookSpec>('{ "__proto__": { "x": 1 }, "name": "A", "formations": 5 }');
    const c = canonicalPlaybook(v);
    expect(Object.keys(c)).toEqual(["name", "__proto__", "formations"]);
    expect(Object.getPrototypeOf(c)).toBe(Object.prototype);
    expect(parseJson(serializeDoc("playbook", v))).toEqual(v);
    expect(canonicalPlaysFile(null as unknown as PlaysFile)).toBe(null);
    expect(serializeDoc("plays", { plays: [1, "x", null, { name: "n" }] })).toBe('{ "plays": [1, "x", null, { "name": "n" }] }\n');
  });
});
