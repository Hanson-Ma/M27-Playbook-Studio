// AUDIBLES tab: one set's four audibles laid out like the in-game audible menu — a face-button diamond
// (Y top, X left, B right, A bottom) using the configured audible buttons (settings.audibleButtons), drawn in the
// audible glyph style the user picked (AudibleGlyph follows settings.audibleStyle: Xbox / PS / keyboard).
import { useMemo } from "react";
import { AudibleGlyph } from "../../input/glyphs";
import { AUDIBLE_CATEGORY, AUDIBLE_SLOTS } from "../../model/audibles";
import { useSettings } from "../../state/settings";
import { EmptySlot, PlaySlot } from "./CallTiles";
import { diamondPositions, type CallPlay, type CallSet } from "./playcallModel";
import s from "./PlayCall.module.css";

export interface AudibleDiamondProps {
  set: CallSet;
  /** Defensive books: the slot categories (Quick Pass, Run…) are offense-only. */
  defense?: boolean;
  flip: boolean;
  favorites: ReadonlySet<string>;
  cursor?: string;
  onOpen(item: CallPlay): void;
  onToggleFavorite(item: CallPlay): void;
}

export function AudibleDiamond({ set, defense, flip, favorites, cursor, onOpen, onToggleFavorite }: AudibleDiamondProps) {
  const buttons = useSettings((st) => st.audibleButtons);
  const positions = useMemo(() => diamondPositions(buttons), [buttons]);
  return (
    <div className={s.diamond}>
      {AUDIBLE_SLOTS.map((slot) => {
        const item = set.audibles[slot];
        const label = defense ? `Audible ${slot}` : AUDIBLE_CATEGORY[slot];
        const sub = defense ? `Audible ${slot}` : `${AUDIBLE_CATEGORY[slot]} · Audible ${slot}`;
        const glyph = <AudibleGlyph slot={slot} size="md" />;
        return (
          <div key={slot} className={s.diamondCell} data-pos={positions[slot]}>
            {item ? (
              <PlaySlot
                item={item}
                size="md"
                glyph={glyph}
                subtitle={sub}
                flip={flip}
                favorite={!!item.play && favorites.has(item.play.key)}
                selected={cursor === item.id}
                onOpen={onOpen}
                onToggleFavorite={onToggleFavorite}
              />
            ) : (
              <EmptySlot glyph={glyph} label={label} sub={sub} />
            )}
          </div>
        );
      })}
    </div>
  );
}
