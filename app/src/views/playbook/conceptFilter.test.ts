import { describe, expect, it } from "vitest";
import type { ConceptsDoc } from "../../model/types";
import { categoryOptions, categoryTest, usableConcepts } from "./conceptFilter";

const doc: ConceptsDoc = {
  version: 1,
  categories: [
    { id: "pass", name: "Pass", group: "pass", color: "#38f" },
    { id: "mesh", name: "Mesh", group: "pass", color: "#f80", parent: "pass" },
    { id: "zone", name: "Inside Zone", group: "run", color: "#e33" },
  ],
  tags: { a: ["mesh"], b: ["pass"], c: ["zone"], d: [] },
};

describe("usableConcepts", () => {
  it("keeps a well-formed doc", () => {
    expect(usableConcepts(doc)?.categories.map((c) => c.id)).toEqual(["pass", "mesh", "zone"]);
  });
  it("returns null for unusable shapes and drops malformed members", () => {
    expect(usableConcepts(null)).toBeNull();
    expect(usableConcepts({ categories: {}, tags: {} })).toBeNull();
    expect(usableConcepts({ categories: [], tags: [] })).toBeNull();
    const cleaned = usableConcepts({ categories: [null, 5, { id: "x", name: "X" }], tags: { a: "x", b: ["x", 3] } })!;
    expect(cleaned.categories.map((c) => c.id)).toEqual(["x"]);
    expect(cleaned.tags).toEqual({ b: ["x"] });
  });
});

describe("categoryOptions / categoryTest", () => {
  it("counts plays per category, a parent including its children's plays", () => {
    const opts = categoryOptions(doc, ["a", "b", "c", "d"]);
    expect(opts.map((o) => [o.cat.id, o.count])).toEqual([
      ["pass", 2],
      ["mesh", 1],
      ["zone", 1],
    ]);
    expect(categoryOptions(doc, ["c"]).map((o) => o.cat.id)).toEqual(["zone"]);
    expect(categoryOptions(null, ["a"])).toEqual([]);
  });
  it("filters by any active category or its descendants", () => {
    const pass = categoryTest(doc, ["pass"]);
    expect(["a", "b", "c", "d"].filter(pass)).toEqual(["a", "b"]);
    const meshOrZone = categoryTest(doc, ["mesh", "zone"]);
    expect(["a", "b", "c", "d"].filter(meshOrZone)).toEqual(["a", "c"]);
    expect(["a", "d"].filter(categoryTest(doc, []))).toEqual(["a", "d"]);
  });
  it("survives a parent cycle", () => {
    const cyc: ConceptsDoc = { ...doc, categories: [{ id: "x", name: "X", group: "pass", color: "#fff", parent: "y" }, { id: "y", name: "Y", group: "pass", color: "#000", parent: "x" }], tags: { p: ["x"] } };
    expect(categoryOptions(cyc, ["p"]).map((o) => o.count)).toEqual([1, 1]);
    expect(["p"].filter(categoryTest(cyc, ["y"]))).toEqual(["p"]);
  });
});
