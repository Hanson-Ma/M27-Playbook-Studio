// Help links into the in-app guide (#/help/<section>[?h=<heading>]).
//
// One "?" per screen: the top bar's "?" (App.tsx) opens the guide section for the screen you're on. A view that needs
// a more specific section than its default (the play-call preview's Audibles tab, a Settings page) names it with
// useHelpTopic() instead of drawing a second "?" of its own.
//
// HelpLink is for contextual text links inside a panel that lead somewhere other than the screen's section:
//   <HelpLink section="audibles" label="How audibles work" />   → "?" + text link
//   <HelpLink section="routes" />                              → icon-only (dev pages / the UI gallery only)
// Sections: getting-started, playbook, audibles, preview, library, concepts, designer, routes, formations, export,
// hosting, faq (views/help/sections.ts).
import { useEffect, useSyncExternalStore } from "react";
import { useTooltip } from "./Tooltip";
import { cx } from "./cx";
import { Icon } from "./Icon";
import s from "./HelpLink.module.css";

export interface HelpLinkProps {
  /** Guide section id (views/help/sections.ts). */
  section: string;
  /** Optional heading id inside the section to scroll to. */
  heading?: string;
  /** Visible text after the "?"; without it the link is icon-only (the tooltip names it). */
  label?: string;
  /** Tooltip / accessible name (default "Help"). */
  title?: string;
  className?: string;
}

export function helpHref(section: string, heading?: string): string {
  return `#/help/${encodeURIComponent(section)}${heading ? `?h=${encodeURIComponent(heading)}` : ""}`;
}

export function HelpLink({ section, heading, label, title, className }: HelpLinkProps) {
  const name = title ?? (label ? undefined : "Help");
  const tip = useTooltip({ content: name, placement: "bottom" });
  return (
    <>
      <a className={cx(s.link, label ? s.withLabel : s.iconOnly, className)} href={helpHref(section, heading)} aria-label={label ? undefined : name} {...tip.handlers}>
        <Icon name="help" size={label ? 15 : 17} />
        {label && <span className={s.label}>{label}</span>}
      </a>
      {tip.node}
    </>
  );
}

// ───────────────────────────── the screen's help topic ─────────────────────────────

export interface HelpTopic {
  section: string;
  heading?: string;
}

let topics: { id: number; topic: HelpTopic }[] = [];
let nextTopicId = 0;
const topicListeners = new Set<() => void>();
const emitTopics = () => topicListeners.forEach((l) => l());

/**
 * While the calling component is mounted, the top bar's "?" opens `section` (and `heading`) instead of the view's
 * default section. The most recently mounted topic wins; `undefined` registers nothing.
 */
export function useHelpTopic(section: string | undefined, heading?: string): void {
  useEffect(() => {
    if (!section) return;
    const id = ++nextTopicId;
    topics = [...topics, { id, topic: { section, heading } }];
    emitTopics();
    return () => {
      topics = topics.filter((t) => t.id !== id);
      emitTopics();
    };
  }, [section, heading]);
}

const subscribeTopics = (l: () => void) => {
  topicListeners.add(l);
  return () => void topicListeners.delete(l);
};
const currentTopic = (): HelpTopic | undefined => topics[topics.length - 1]?.topic;

/** The topic a mounted view asked for with useHelpTopic() (undefined: use the view's default section). */
export function useScreenHelpTopic(): HelpTopic | undefined {
  return useSyncExternalStore(subscribeTopics, currentTopic, currentTopic);
}
