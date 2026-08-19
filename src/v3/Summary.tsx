import { CIV_COLOUR } from "./BeliefMap";
import { RuleNote, useTeach } from "./RuleNote";
import { civLabel, useLang } from "./lang";
import { RULES } from "../sim/config";
import type { SeriesPoint } from "./Charts";
import type { CivId, Frame } from "../sim/types";

/**
 * One sentence per civilization per turn. If a reader reads nothing else on this page, they still
 * have the season.
 *
 * Underneath it, the same turn as a ledger rather than a set of values: `219 − 12 upkeep + 15 = 222`.
 * Writing the arithmetic out teaches the upkeep rule silently, with the civilization's own numbers,
 * and it never has to be stated as a rule at all.
 *
 * Only two of the three terms are known exactly. Upkeep is `workers × 1`, charged from the store
 * before anybody decides anything, and the closing figure is recorded. Everything else that moved —
 * deposits in, migration and construction out — nets into one term, and it is labelled as a net
 * rather than dressed up as a deposit total the data cannot support.
 */

const RULE = "#ded5c4";
const MUTED = "#8a8172";
const INK_2 = "#55524a";

export function Summary({
  frame,
  series,
  turn,
  slots,
  protocolVersion,
}: {
  frame: Frame;
  series: SeriesPoint[] | null;
  turn: number;
  slots: Record<CivId, number>;
  protocolVersion: number;
}) {
  const { lang } = useLang();
  const { teach } = useTeach();
  if (!teach) return null;

  const at = (value: number) => series?.find((entry) => entry.turn === value);
  const current = at(turn);
  const previous = at(turn - 1);

  return (
    <section style={{ borderTop: `1px solid ${RULE}`, marginTop: 16, paddingTop: 14 }}>
      <div style={{ display: "grid", gap: 12 }}>
        {(["north", "south"] as CivId[]).map((civ) => {
          const stats = frame.civs[civ];
          const before = previous?.civs[civ];
          const now = current?.civs[civ] ?? stats;
          const ate = (before?.workers ?? stats.workers) * RULES.upkeep;
          const net = before ? now.food - before.food + ate : 0;
          const change = before ? now.workers - before.workers : 0;

          return (
            <div key={civ}>
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.7 }}>
                <span style={{ color: CIV_COLOUR[civ] }}>{civLabel(civ, lang)}</span>{" "}
                {before
                  ? sentence(lang, {
                      workers: before.workers,
                      ate,
                      from: before.food,
                      to: now.food,
                      change,
                    })
                  : opening(lang, stats.workers, stats.food, stats.stone)}
              </p>
              {before ? (
                <p
                  style={{
                    margin: "2px 0 0",
                    fontSize: 12.5,
                    color: INK_2,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {before.food}
                  <span style={{ color: MUTED }}> − {ate} </span>
                  {lang === "zh" ? "上繳" : "upkeep"}
                  <span style={{ color: MUTED }}> {net >= 0 ? "+" : "−"} {Math.abs(net)} </span>
                  {lang === "zh" ? "其餘進出淨額" : "net of everything else"}
                  <span style={{ color: MUTED }}> = </span>
                  {now.food}
                </p>
              ) : null}
              <RuleNote rule="food" context={{ civ: stats, slots: slots[civ], turn, protocolVersion }} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** A template per language with slots, never concatenation — glued fragments read like a robot. */
function sentence(
  lang: "zh" | "en",
  values: { workers: number; ate: number; from: number; to: number; change: number },
) {
  const { workers, ate, from, to, change } = values;
  if (lang === "zh") {
    const tail =
      change > 0
        ? `${change} 名成年人加入。`
        : change < 0
          ? `${-change} 人餓死。`
          : "今回合沒有人加入，也沒有人死去。";
    return `${workers} 人吃掉 ${ate} 糧，倉存由 ${from} 變 ${to}；${tail}`;
  }
  const tail =
    change > 0
      ? `${change} adult${change > 1 ? "s" : ""} joined.`
      : change < 0
        ? `${-change} worker${change < -1 ? "s" : ""} starved.`
        : "Nobody joined and nobody died.";
  return `— ${workers} workers ate ${ate} food, and the store went from ${from} to ${to}. ${tail}`;
}

function opening(lang: "zh" | "en", workers: number, food: number, stone: number) {
  return lang === "zh"
    ? `以 ${workers} 人、${food} 糧、${stone} 石開局。`
    : `— opens with ${workers} workers, ${food} food and ${stone} stone.`;
}
