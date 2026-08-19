import { CIV_COLOUR } from "./BeliefMap";
import { Caption, RuleNote } from "./RuleNote";
import { civLabel, useLang } from "./lang";
import type { CivId, Frame } from "../sim/types";

/**
 * One bar per civilization, split into what is **stored** and what is still **in backpacks**,
 * against the aggregate capacity of the civilization's physical storage structures, with a tick at next turn's upkeep and a tick at the food a new
 * adult needs. When the backpack segment grows while stored stays flat, the reader is looking at
 * v14's deposit deadlock without having to be told it exists.
 *
 * Food and stone share space inside each physical storage structure. The spectator aggregates those
 * local structures into one comparison bar; the engine never turns them into a remote inventory.
 *
 * Goods spilled on the ground belong to nobody — the engine drops them where a worker died and
 * never assigns them an owner — so they are reported separately rather than guessed into a civ's
 * column.
 */

const RULE = "#ded5c4";
const INK = "#2b2723";
const MUTED = "#8a8172";

/**
 * Ticks label themselves below the bar, so a long label never collides with the heading above — and
 * on the second row when the two ticks are close enough to collide with each other. Upkeep and the
 * join threshold sit a few per cent apart on a 630-space bar, which on a phone printed the two
 * labels straight through one another and made both unreadable.
 */
function Tick({ at, label, colour = INK, row = 0 }: { at: number; label: string; colour?: string; row?: number }) {
  if (at < 0 || at > 1) return null;
  return (
    <div style={{ position: "absolute", left: `${at * 100}%`, top: -3, bottom: -16 }}>
      <div style={{ width: 1, height: 19 + row * 11, background: colour }} />
      <div
        style={{
          position: "absolute",
          top: 20 + row * 11,
          // A tick past three quarters of the bar would push its label off the right edge.
          left: at > 0.75 ? undefined : 2,
          right: at > 0.75 ? 2 : undefined,
          fontSize: 9,
          color: MUTED,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
    </div>
  );
}

export function ResourceBars({ frame, slots, protocolVersion }: { frame: Frame; slots: Record<CivId, number>; protocolVersion: number }) {
  const { t, lang } = useLang();
  const ground = frame.piles.reduce(
    (sum, pile) => ({ food: sum.food + pile.stock.food, stone: sum.stone + pile.stock.stone }),
    { food: 0, stone: 0 },
  );

  return (
    <section style={{ borderTop: `1px solid ${RULE}`, marginTop: 20, paddingTop: 16 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.08em", color: MUTED, textTransform: "uppercase", marginBottom: 14 }}>
        {t("stores")}
      </div>
      <Caption>{t("capStores")}</Caption>

      <div style={{ display: "grid", gap: 22 }}>
        {(["north", "south"] as CivId[]).map((civ) => {
          const stats = frame.civs[civ];
          const capacity = Math.max(1, stats.storageCapacity ?? 1);
          const stored = stats.food + stats.stone;
          const carried = stats.carried;
          const upkeep = stats.workers;
          const threshold = stats.migrationFoodRequired;
          return (
            <div key={civ}>
              <div style={{ display: "flex", gap: 18, alignItems: "baseline", marginBottom: 6, flexWrap: "wrap" }}>
                <div style={{ color: CIV_COLOUR[civ], fontSize: 15 }}>{civLabel(civ, lang)}</div>
                <div style={{ fontSize: 12, color: MUTED }}>
                  {t("stored")} {stored} · {t("inBackpacks")} {carried} · {t("capacity")} {capacity}
                  {stored + carried > capacity ? ` · ${t("wouldOverflow")}` : ""}
                </div>
              </div>
              <div
                style={{
                  position: "relative",
                  height: 16,
                  marginBottom: 34,
                  background: "#f2ece0",
                  border: `1px solid ${RULE}`,
                  overflow: "visible",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${Math.min(100, (stats.food / capacity) * 100)}%`,
                    background: CIV_COLOUR[civ],
                  }}
                  title={`${t("food")} ${stats.food}`}
                />
                <div
                  style={{
                    position: "absolute",
                    left: `${Math.min(100, (stats.food / capacity) * 100)}%`,
                    top: 0,
                    bottom: 0,
                    width: `${Math.min(100, (stats.stone / capacity) * 100)}%`,
                    background: `${CIV_COLOUR[civ]}77`,
                  }}
                  title={`${t("stone")} ${stats.stone}`}
                />
                <div
                  style={{
                    position: "absolute",
                    left: `${Math.min(100, (stored / capacity) * 100)}%`,
                    top: 0,
                    bottom: 0,
                    width: `${Math.max(0, Math.min(100 - (stored / capacity) * 100, (carried / capacity) * 100))}%`,
                    backgroundImage: `repeating-linear-gradient(45deg, ${CIV_COLOUR[civ]}55 0 3px, transparent 3px 6px)`,
                    borderLeft: carried > 0 ? `1px solid ${CIV_COLOUR[civ]}` : undefined,
                  }}
                  title={`${t("inBackpacks")} ${carried}`}
                />
                <Tick at={upkeep / capacity} label={`${t("upkeepTick")} ${upkeep}`} />
                {/* Protocol 11 removed the food threshold for a birth: a child comes of age on a
                    fully-fed streak, not on a stored total. The frame stops carrying the figure,
                    and `?? 0` turned that absence into a "join threshold 0" tick pinned to the left
                    edge of both bars — a rule that no longer exists, drawn as if it were met. */}
                {threshold === undefined ? null : (
                  <Tick
                    at={threshold / capacity}
                    label={`${t("joinTick")} ${threshold}`}
                    colour={MUTED}
                    row={Math.abs(threshold - upkeep) / capacity < 0.28 ? 1 : 0}
                  />
                )}
              </div>
              <RuleNote rule="capacity" context={{ civ: stats, slots: slots[civ], turn: frame.turn, protocolVersion }} />
            </div>
          );
        })}
      </div>

      <div style={{ fontSize: 12, color: MUTED, marginTop: 12 }}>
        {t("onTheGround")}: {t("food")} {ground.food} · {t("stone")} {ground.stone}
        {ground.food + ground.stone > 0 ? ` · ${t("groundNote")}` : ""}
      </div>
    </section>
  );
}
