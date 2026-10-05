// Display-only Title Case for app-made labels (route presets, cuts, block tools, enum words): every word capitalized
// except minor words (a, an, the, and, of, to…) unless first or last, both ends of hyphenated words ("Slant-and-Go"),
// words that already carry capitals or digits ("QB", "WR1", "RR") and units ("yd") left as they are. Never for user-typed names.
const MINOR = new Set(["a", "an", "the", "and", "but", "or", "nor", "for", "so", "as", "at", "by", "in", "of", "off", "on", "per", "to", "up", "via", "vs"]);

/** Units stay lowercase ("2 yd Outside TE"). */
const UNITS = new Set(["yd", "yds", "s", "ft", "mph"]);

const cap = (w: string) => w.replace(/[a-z]/, (c) => c.toUpperCase());

export function titleCase(text: string): string {
  const parts = text.split(/(\s+)/);
  const wordIdx = parts.map((p, i) => (/\S/.test(p) ? i : -1)).filter((i) => i >= 0);
  const first = wordIdx[0];
  const last = wordIdx[wordIdx.length - 1];
  return parts
    .map((p, i) => {
      if (!/\S/.test(p)) return p;
      const pieces = p.split("-");
      return pieces
        .map((piece, j) => {
          const bare = piece.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
          if (!bare || /[A-Z0-9]/.test(bare) || UNITS.has(bare)) return piece;
          const edge = (i === first && j === 0) || (i === last && j === pieces.length - 1) || (pieces.length > 1 && (j === 0 || j === pieces.length - 1));
          return !edge && MINOR.has(bare.toLowerCase()) ? piece : cap(piece);
        })
        .join("-");
    })
    .join("");
}
