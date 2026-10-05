// ADVANCED tab: the technical controls kept out of the everyday tabs — release details, the assignment behind the
// player (library path / authored name, route type, keep / template), raw steps, and the in-game note about red
// routes.
import { isEligible } from "../../model/positions";
import { Disclosure } from "./Disclosure";
import { InfoTab } from "./InfoTab";
import { ReleaseSection } from "./ReleaseTab";
import { StepsTab } from "./StepsTab";
import { useDesigner } from "./shared";
import s from "./Inspector.module.css";

export function AdvancedTab({ slot, lock }: { slot: number; lock: number }) {
  const d = useDesigner();
  const a = d.set.movements.Normal[slot];
  const eligible = !!a && isEligible(a);
  return (
    <>
      <p className={s.note}>Technical details for this player. Everything here is optional — the Route, Block and Motion tabs cover normal play design.</p>
      {eligible && (
        <Disclosure id="adv.release" title="Release" hint="first step off the line" defaultOpen>
          <ReleaseSection slot={slot} lock={lock} />
        </Disclosure>
      )}
      <InfoTab slot={slot} />
      <Disclosure id="adv.steps" title="Raw steps" hint="the exact step list">
        <StepsTab slot={slot} lock={lock} bare />
      </Disclosure>
      {eligible && (
        <Disclosure id="adv.red" title="Red routes in the game" hint="primary receiver">
          <p className={s.note}>
            The primary receiver (red route) is the play's <code>vip</code> slot. Stock plays have exactly one red route. In testing, plays whose reads were rewritten
            (all combo 0, Concept_Invalid) showed several red routes in the game, so keep the base play's reads unless you need to change them, and set the
            primary receiver explicitly when it changes (reads are under Advanced in the play panel on the left).
          </p>
        </Disclosure>
      )}
    </>
  );
}
