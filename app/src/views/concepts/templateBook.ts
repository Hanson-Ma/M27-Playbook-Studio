// A playbook's `"sets": "template"` sections as a ResolvedBook of their own: the template save's sets / plays for each
// template formation (state/template.ts → model/tdb.ts), resolved as library plays with their audible + CPU weights.
// Lets gameplan queries written for a ResolvedBook (model/concepts.ts situationPlays / situationCounts) count what
// the game-side builder will copy. Refs keep `f` = the spec's template-section index (s / p index the template), so
// `isTemplateRef(book, ref)` tells them apart from the file's own plays.
import { resolveLibraryPlay } from "../../model/catalog";
import type { BookPlayRef } from "../../model/concepts";
import type { LibraryIndex } from "../../model/library";
import type { ResolvedBook, ResolvedBookFormation } from "../../model/resolveBook";
import { norm } from "../../model/names";
import { templateFormationFor, type TemplateContents, type TemplateFormation } from "../../model/tdb";
import type { FormationDef, PlayEntry } from "../../model/types";

const cache = new WeakMap<ResolvedBook, { contents: TemplateContents; book: ResolvedBook }>();

/** The book's template sections filled from the template save (empty formations list when there are none). */
export function templateSectionsBook(book: ResolvedBook, contents: TemplateContents, lib: LibraryIndex): ResolvedBook {
  const hit = cache.get(book);
  if (hit && hit.contents === contents) return hit.book;
  const formations: ResolvedBookFormation[] = [];
  for (const rf of book.formations) {
    if (!rf.template) continue;
    // What tools/pbook-build.mjs copies: the template's sets of the formation it resolves the name to (by side,
    // preferring a formation the template contains — commit ac54574).
    const tf = sectionTemplate(contents, lib, rf.formation, String(rf.entry.formation ?? ""));
    if (!tf || !tf.sets.length) continue;
    formations.push({
      entry: rf.entry,
      index: rf.index,
      formation: rf.formation,
      // Filled in: the gameplan queries skip `template` formations.
      template: false,
      sets: tf.sets.map((ts, si) => {
        const entries = ts.plays.map((tp): PlayEntry => {
          const e: PlayEntry = { play: tp.play.name };
          if (tp.audible) e.audible = tp.audible;
          if (tp.cpu) e.cpu = { ...tp.cpu };
          return e;
        });
        return {
          entry: { set: ts.set.name, plays: entries },
          index: si,
          set: ts.set,
          plays: ts.plays.map((tp, pi) => ({ entry: entries[pi], index: pi, play: resolveLibraryPlay(lib, tp.play) })),
        };
      }),
    });
  }
  const out: ResolvedBook = { formations, counts: book.counts };
  cache.set(book, { contents, book: out });
  return out;
}

/** The section's formation in the template save, else a same-name formation of the same side that the save has. */
function sectionTemplate(contents: TemplateContents, lib: LibraryIndex, formation: FormationDef | undefined, name: string): TemplateFormation | undefined {
  const direct = templateFormationFor(contents, formation);
  if (direct || !name) return direct;
  const side = formation ? lib.formationSide(formation) : undefined;
  return contents.formations.find((tf) => norm(tf.formation.name) === norm(name) && (!side || lib.formationSide(tf.formation) === side) && tf.sets.length > 0);
}

/** True for refs that come from a template section of `book` (see templateSectionsBook). */
export function isTemplateRef(book: ResolvedBook, ref: Pick<BookPlayRef, "f">): boolean {
  return !!book.formations[ref.f]?.template;
}
