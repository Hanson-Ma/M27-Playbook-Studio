import { afterEach, describe, expect, it } from "vitest";
import { buildCatalog } from "../../model/catalog";
import { buildLibraryIndex } from "../../model/library";
import { loadLibraryData, loadPlaysDoc } from "../../model/libFixture";
import type { PlaybookSpec, PlaysFile, SetEntry } from "../../model/types";
import { useWorkspace } from "../../state/workspace";
import type { BookNode, BuilderData } from "./context";
import { duplicateSelection } from "./ops";
import { useBuilderUi } from "./store";

const lib = buildLibraryIndex(loadLibraryData());
const ytrips = loadPlaysDoc("pbs-ytrips-v1.json");
const BOOK = "playbooks/test-book.json";

afterEach(() => {
  useWorkspace.setState({ docs: {} });
  useBuilderUi.setState({ selected: [], cursor: "" });
});

function setup(playName: string) {
  const ws = useWorkspace.getState();
  ws.create<PlaysFile>(ytrips.path, "plays", structuredClone(ytrips.data));
  ws.create<PlaybookSpec>(BOOK, "playbook", { formations: [{ formation: "Shotgun", sets: [{ set: "Y Trips Wk", plays: [{ play: playName }, { play: "Curls" }] }] }] } as PlaybookSpec);
  const catalog = buildCatalog(lib, [{ path: ytrips.path, data: structuredClone(ytrips.data) }]);
  const custom = catalog.custom.find((p) => p.name === playName)!;
  const stock = catalog.lib.playsBySet.get(custom.set)!.find((p) => p.name === "Curls")!;
  const data = {
    path: BOOK,
    catalog,
    book: { formations: [{ sets: [{ plays: [{ play: custom }, { play: catalog.get(stock.asset) }] }] }] },
    nodes: new Map<string, BookNode>([["p0", { id: "p0", level: "play", ref: { f: 0, s: 0, p: 0 } } as BookNode], ["p1", { id: "p1", level: "play", ref: { f: 0, s: 0, p: 1 } } as BookNode]]),
    edit: (label: string, recipe: (d: PlaybookSpec) => void) => useWorkspace.getState().update<PlaybookSpec>(BOOK, recipe, { label }),
  } as unknown as BuilderData;
  return { data, custom };
}

const book = () => ((useWorkspace.getState().docs[BOOK].data as PlaybookSpec).formations![0].sets as SetEntry[])[0].plays.map((p) => p.play);
const plays = () => (useWorkspace.getState().docs[ytrips.path].data as PlaysFile).plays;

describe("duplicating a playbook entry", () => {
  it("copies a custom play, so the duplicate has its own routes", () => {
    const { data, custom } = setup("PBS Mtn Drive");
    useBuilderUi.setState({ selected: ["p0"], cursor: "p0" });
    const before = plays().length;
    duplicateSelection(data);
    expect(plays()).toHaveLength(before + 1);
    const at = custom.index!;
    expect(plays()[at].name).toBe("PBS Mtn Drive");
    expect(plays()[at + 1].name).toBe("PBS Mtn Drive copy");
    expect(plays()[at + 1].asset).not.toBe(plays()[at].asset);
    expect(plays()[at + 1].players).toEqual(plays()[at].players);
    // the new entry names the copy, right after the original
    expect(book()).toEqual(["PBS Mtn Drive", "PBS Mtn Drive copy", "Curls"]);
  });

  it("leaves a stock play's duplicate alone (nothing to copy)", () => {
    const { data } = setup("PBS Mtn Drive");
    useBuilderUi.setState({ selected: ["p1"], cursor: "p1" });
    const before = plays().length;
    duplicateSelection(data);
    expect(plays()).toHaveLength(before);
    expect(book()).toEqual(["PBS Mtn Drive", "Curls", "Curls"]);
  });
});
