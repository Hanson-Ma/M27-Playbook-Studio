// What "Convert to explicit" / "New from stock template" leave out: template plays a spec can't list by name (filed
// under a foreign set, or a name pbook-build would resolve to another play) and formations kept as "template".
import type { TemplateSkip } from "../../model/tdb";
import s from "./skipped.module.css";

export function SkippedList({ skipped, kept = [] }: { skipped: TemplateSkip[]; kept?: { formation: string; reason: string }[] }) {
  return (
    <div className={s.wrap}>
      {kept.length > 0 && (
        <>
          <div className={s.head}>Kept as template sections</div>
          <ul className={s.list}>
            {kept.map((k) => (
              <li key={k.formation}>
                <b>{k.formation}</b>
                <span className={s.reason}>{k.reason}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {skipped.length > 0 && (
        <>
          <div className={s.head}>
            Left out: {skipped.length} play{skipped.length === 1 ? "" : "s"}
          </div>
          <ul className={s.list}>
            {skipped.map((k, i) => (
              <li key={`${k.formation}/${k.set}/${k.asset}/${i}`}>
                <b>
                  {k.set} / {k.play}
                </b>
                <span className={s.reason}>{k.reason}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** "Set / Play" lines for a toast. */
export function skippedLine(skipped: TemplateSkip[], max = 6): string {
  const shown = skipped.slice(0, max).map((k) => `${k.set} / ${k.play}`);
  return shown.join(", ") + (skipped.length > max ? ` and ${skipped.length - max} more` : "");
}
