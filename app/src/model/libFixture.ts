// Test-only fixture: loads the real game library and example specs from the repo (node fs; never imported by the app).
import { readFileSync } from "node:fs";
import type { LibraryData, PlaybookSpec, PlaysFile, SetsFile } from "./types";

const REPO = new URL("../../../", import.meta.url);

const readJson = <T>(rel: string): T => JSON.parse(readFileSync(new URL(rel, REPO), "utf8").replace(/^﻿/, "")) as T;

let cached: LibraryData | undefined;

/** data/library/*.json, parsed once per test file (the plays file is 18 MB). */
export function loadLibraryData(): LibraryData {
  return (cached ??= {
    formations: readJson("data/library/formations.json"),
    sets: readJson("data/library/sets.json"),
    plays: readJson("data/library/plays.json"),
    assignments: readJson("data/library/assignments.json"),
    enums: readJson("data/library/enums.json"),
  });
}

/** A playbooks/plays/*.json example as a catalog input. */
export function loadPlaysDoc(name: string): { path: string; data: PlaysFile } {
  const path = `playbooks/plays/${name}`;
  return { path, data: readJson<PlaysFile>(path) };
}

/** A playbooks/sets/*.json file as a catalog / validation input. */
export function loadSetsDoc(name: string): { path: string; data: SetsFile } {
  const path = `playbooks/sets/${name}`;
  return { path, data: readJson<SetsFile>(path) };
}

/** A playbooks/*.json playbook spec. */
export function loadPlaybook(name: string): PlaybookSpec {
  return readJson<PlaybookSpec>(`playbooks/${name}`);
}

/** Rows of a research/index/*.tsv file (game-side build manifests) as objects; [] when the file doesn't exist. */
export function loadIndexTsv(name: string): Record<string, string>[] {
  let text: string;
  try {
    text = readFileSync(new URL(`research/index/${name}.tsv`, REPO), "utf8").replace(/^﻿/, "");
  } catch {
    return [];
  }
  const [head, ...rows] = text.trim().split(/\r?\n/);
  const cols = head.split("\t");
  return rows.map((r) => Object.fromEntries(r.split("\t").map((v, i) => [cols[i], v])));
}

/**
 * playbooks/studio-test.json as of commit 96c53d3, frozen so the user's edits to the live file don't move test
 * expectations: Shotgun with Y Trips Wk (17 plays) and Bunch (2), then four template sections. No custom
 * formations or sets (the live file now also uses the sets overlay; catalog/resolveBook tests cover that).
 * Returns a fresh deep copy each call.
 */
export function studioV1(): PlaybookSpec {
  const plays = (...names: string[]) => names.map((play) => ({ play }));
  return {
    name: "STUDIO",
    side: "offense",
    notes: "fixture",
    formations: [
      {
        formation: "Shotgun",
        sets: [
          {
            set: "Y Trips Wk",
            plays: [
              { play: "PBS GT Counter", audible: 2, cpu: { FirstDown: 40, "2ndAndShort": 50, "3rdAndShort": 30 } },
              { play: "PBS PA Yankee", audible: 4, cpu: { Playaction: 40, "2ndAndShort": 30 } },
              { play: "PBS Snag", cpu: { "3rdAndMedium": 40, FirstDown: 20 } },
              { play: "PBS Bubble Go", audible: 3, cpu: { "2ndAndLong": 20 } },
              { play: "PBS Reverse QB Lead", cpu: { SuddenChange: 10 } },
              { play: "PBS Mtn Drive", cpu: { "3rdAndMedium": 30, "3rdAndLong": 20 } },
              ...plays("Inside Zone", "Mtn Mesh", "Spacing Snag", "Mtn PA Smash Scissors", "Four Verticals"),
              { play: "Slants", audible: 1 },
              ...plays("PBS Art A", "PBS Art B", "PBS Art C", "PBS Art D", "PBS Art E"),
            ],
          },
          { set: "Bunch", plays: plays("Mesh", "Reverse") },
        ],
      },
      { formation: "Goal Line Offense", sets: "template" },
      { formation: "Special", sets: "template" },
      { formation: "Kickoff", sets: "template" },
      { formation: "Safety Kickoff", sets: "template" },
    ],
  };
}
