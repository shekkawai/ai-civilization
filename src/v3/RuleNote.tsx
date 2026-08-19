import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { explain, type RuleContext, type RuleKey } from "./rules";
import { useLang } from "./lang";

/**
 * Click any number to see the rule that produced it.
 *
 * The page can already say a civilization has nine people. It cannot, on its own, say how a person
 * appears at all — that a check runs every second turn, needs a free place *and* fifteen food plus
 * five turns of reserve for the larger population, and spends the fifteen when it fires. Without
 * the mechanism the number is trivia; with it, the same number says which condition is about to
 * fail.
 *
 * A `<details>` rather than a popover on purpose: nothing on this page floats over anything else,
 * and an expanding block behaves identically at 390px and 1400px with no positioning to get wrong.
 */

const RULE = "#ded5c4";
const MUTED = "#8a8172";
const INK_2 = "#55524a";

/**
 * One switch for every explanation on the page. On by default — a first-time reader needs the
 * teaching more than a returning one needs the quiet — and remembered per browser afterwards.
 */
const TeachContext = createContext<{ teach: boolean; setTeach: (value: boolean) => void }>({
  teach: true,
  setTeach: () => {},
});

const STORAGE_KEY = "aiciv-v3-teach";

export function TeachProvider({ children }: { children: ReactNode }) {
  const [teach, setTeachState] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  });
  const value = useMemo(
    () => ({
      teach,
      setTeach: (next: boolean) => {
        setTeachState(next);
        if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
      },
    }),
    [teach],
  );
  return <TeachContext.Provider value={value}>{children}</TeachContext.Provider>;
}

export function useTeach() {
  return useContext(TeachContext);
}

/** A caption under a section heading: what you are looking at, in one sentence. Teachable. */
export function Caption({ children }: { children: ReactNode }) {
  const { teach } = useTeach();
  if (!teach) return null;
  return (
    <p style={{ margin: "0 0 12px", fontSize: 12.5, lineHeight: 1.65, color: INK_2, maxWidth: "78ch" }}>
      {children}
    </p>
  );
}

/**
 * Prose that is available rather than present (Shek's call, 2026-08-08: "explain text on demand
 * when user click").
 *
 * Every paragraph on this page earns its place by being true, and the page had accumulated enough
 * of them that a phone screen was mostly justification. The prose is not the problem — printing all
 * of it unasked is. `Note` keeps the whole explanation one tap away and gives it a stable, obviously
 * clickable handle, so the default view is figures and the reasoning arrives when a reader wants it.
 *
 * It is a `<details>`, so it needs no state, no positioning, and behaves identically at 390px and
 * 1400px. `open` seeds the first render only — a section that is genuinely unreadable without its
 * key (the map legend) may open itself on a wide screen.
 */
export function Note({
  children,
  label,
  open = false,
  inline = false,
}: {
  children: ReactNode;
  /** Overrides the default handle. Say what the explanation is about, never just "more". */
  label?: string;
  open?: boolean;
  /** Sits on the end of a figure's own line rather than on a line of its own. */
  inline?: boolean;
}) {
  const { teach } = useTeach();
  const { lang } = useLang();
  if (!teach) return null;
  return (
    <details
      open={open}
      style={{ margin: inline ? 0 : "4px 0 0", display: inline ? "inline-block" : undefined }}
    >
      <summary
        style={{
          cursor: "pointer",
          listStyle: "none",
          fontSize: 11,
          color: MUTED,
          textDecoration: "underline dotted",
          textUnderlineOffset: 3,
          display: "inline-block",
          padding: "2px 0",
        }}
      >
        {label ?? (lang === "zh" ? "這是什麼意思？" : "what does this mean?")}
      </summary>
      <div
        style={{
          marginTop: 4,
          borderLeft: `2px solid ${RULE}`,
          paddingLeft: 10,
          maxWidth: "72ch",
          fontSize: 12,
          lineHeight: 1.7,
          color: INK_2,
        }}
      >
        {children}
      </div>
    </details>
  );
}

/**
 * The rule behind one figure, docked wherever the caller puts it — used when a whole row of numbers
 * shares one explanation slot, so clicking a second number replaces the panel instead of pushing
 * the page around.
 */
export function RulePanel({ rule, context }: { rule: RuleKey; context: RuleContext }) {
  const { lang } = useLang();
  const { teach } = useTeach();
  const explanation = useMemo(() => explain(rule, context, lang), [rule, context, lang]);
  if (!teach) return null;
  return (
    <div style={{ marginTop: 8, borderLeft: `2px solid ${RULE}`, paddingLeft: 10, maxWidth: "70ch" }}>
      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.65, color: INK_2 }}>{explanation.rule}</p>
      <ol style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7, color: INK_2 }}>
        {explanation.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  );
}

/** The rule behind one figure, with this civilization's numbers already in it. */
export function RuleNote({ rule, context }: { rule: RuleKey; context: RuleContext }) {
  const { lang, t } = useLang();
  const { teach } = useTeach();
  const explanation = useMemo(() => explain(rule, context, lang), [rule, context, lang]);
  if (!teach) return null;
  return (
    <details style={{ marginTop: 6 }}>
      <summary
        style={{
          cursor: "pointer",
          listStyle: "none",
          fontSize: 11,
          color: MUTED,
          textDecoration: "underline dotted",
          textUnderlineOffset: 3,
        }}
      >
        {t("ruleOpen")}
      </summary>
      <div
        style={{
          marginTop: 6,
          borderLeft: `2px solid ${RULE}`,
          paddingLeft: 10,
          maxWidth: "70ch",
        }}
      >
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.65, color: INK_2 }}>{explanation.rule}</p>
        <ol style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7, color: INK_2 }}>
          {explanation.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
    </details>
  );
}
