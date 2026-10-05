import { describe, expect, it } from "vitest";
import { categoriesForPlay, categoryWithDescendants, playsInCategory } from "./conceptsDoc";
import type { ConceptsDoc } from "./types";

const doc: ConceptsDoc = {
  version: 1,
  categories: [
    { id: "pass", name: "Pass", group: "pass", color: "#fff" },
    { id: "mesh", name: "Mesh", group: "pass", color: "#fff", parent: "pass" },
  ],
  tags: { a: ["mesh"], b: ["pass"] },
};

describe("concepts.json readers", () => {
  it("read tags and nested categories", () => {
    expect(categoriesForPlay(doc, "a").map((c) => c.id)).toEqual(["mesh"]);
    expect([...categoryWithDescendants(doc, "pass")]).toEqual(["pass", "mesh"]);
    expect(playsInCategory(doc, "pass").sort()).toEqual(["a", "b"]);
  });

  it("never throw on a hand-edited file with the wrong shape", () => {
    const bad = [
      { version: 1, categories: {}, tags: [] },
      { version: 1, categories: [null, 5, "x"], tags: { a: 7, b: null } },
      { version: 1, categories: "nope", tags: "nope" },
    ] as unknown as ConceptsDoc[];
    for (const d of bad) {
      expect(categoriesForPlay(d, "a")).toEqual([]);
      expect([...categoryWithDescendants(d, "pass")]).toEqual(["pass"]);
      expect(playsInCategory(d, "pass")).toEqual([]);
    }
  });
});
