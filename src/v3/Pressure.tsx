import { useEffect, useMemo, useState } from "react";
import { Chart } from "./Charts";
import { CIV_COLOUR } from "./BeliefMap";
import { Caption } from "./RuleNote";
import { civLabel, useLang } from "./lang";
import { homeCentre, readMap } from "../lib/strategy";
import { RULES, structureUpkeepFreeBlocks } from "../sim/config";
import type { CivId, Frame, Tile } from "../sim/types";

/**
 * Whether each civilization is still solvent, and what it would cost to fix it.
 *
 * Every other surface on this page reports a *level* — 222 food, 12 stone, 12 people. A level says
 * nothing about whether a decision was a good one, because the same 12 stone is comfortable on one
 * map and three turns from collapse on another. What separates those two cases is arithmetic the
 * engine already fixes: income against upkeep, and the walking distance to the next source.
 *
 * So this panel prints three runways, all of them division:
 *
 *   食物續航   stored food ÷ (people − harvest)
 *   石材續航   stored stone ÷ structure upkeep due each turn
 *   取得成本   turns of walking to the nearest source of whatever has run out
 *
 * When the third exceeds the first two, the civilization is already lost and has not noticed. That
 * is the whole explore-or-die thesis expressed as two numbers a reader can compare at a glance,
 * and it is the reading no chart of levels can give.
 *
 * Two boundaries, both inherited and both load-bearing:
 *
 *   - **No ranking, no verdict.** The rules define no victory condition, so this never says a side
 *     is winning or that a decision was wrong. It states what the engine will do next and what it
 *     would cost to avoid — the reader draws the conclusion.
 *   - **None of this may ever reach a player.** It is derived client-side from `config.ts`, the
 *     terrain and the recorded stats. The agents receive the private report and nothing else, and
 *     several of these figures are marked 🔒 precisely because they never will.
 */

const RULE = "#ded5c4";
const INK = "#2b2723";
const MUTED = "#8a8172";
const ALARM = "#9c3c3c";
const CALM = "#4a6b45";

export interface PressurePoint {
  turn: number;
  civ: CivId;
  reach: number;
  meanReach: number;
  beyondHome: number;
  workers: number;
  standingBlocks?: number;
  upkeepDue?: number;
  upkeepPaid?: number;
  blocksLost?: number;
}

export interface HarvestRow {
  turn: number;
  civ: CivId;
  food: number;
  stone: number;
}

/** A runway in turns, or `null` for "income covers it". */
function runway(stored: number, drainPerTurn: number): number | null {
  if (drainPerTurn <= 0) return null;
  return Math.floor(stored / drainPerTurn);
}

function Reading({
  label,
  value,
  tone,
  detail,
}: {
  label: string;
  value: string;
  tone: "calm" | "watch" | "alarm";
  detail: React.ReactNode;
}) {
  const colour = tone === "alarm" ? ALARM : tone === "watch" ? "#8a6a2f" : CALM;
  return (
    <div style={{ flex: "1 1 220px", minWidth: 200 }}>
      <div style={{ fontSize: 10, letterSpacing: "0.1em", color: MUTED, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 19, color: colour, fontVariantNumeric: "tabular-nums", lineHeight: 1.4 }}>{value}</div>
      <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.6 }}>{detail}</div>
    </div>
  );
}

export function Pressure({
  seasonId,
  frame,
  tiles,
  turn,
  maxTurn,
  protocolVersion,
  onScrub,
}: {
  seasonId: string;
  frame: Frame;
  tiles: Tile[] | null;
  turn: number;
  maxTurn: number;
  protocolVersion: number;
  onScrub: (turn: number) => void;
}) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const [pressure, setPressure] = useState<PressurePoint[]>([]);
  const [hasUpkeepRule, setHasUpkeepRule] = useState(false);
  const [harvest, setHarvest] = useState<HarvestRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/research/pressure?seasonId=${encodeURIComponent(seasonId)}`, {
        headers: { Accept: "application/json" },
      }).then((response) => (response.ok ? response.json() : [])),
      fetch(`/api/research/harvest?seasonId=${encodeURIComponent(seasonId)}`, {
        headers: { Accept: "application/json" },
      }).then((response) => (response.ok ? response.json() : [])),
    ]).then(([pressurePayload, harvestRows]) => {
      if (cancelled) return;
      const payload = pressurePayload as { structureUpkeep?: boolean; rows?: PressurePoint[] } | null;
      setPressure(payload?.rows ?? []);
      setHasUpkeepRule(Boolean(payload?.structureUpkeep));
      setHarvest((harvestRows as HarvestRow[]) ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [seasonId]);

  const facts = useMemo(() => (tiles ? readMap(tiles) : null), [tiles]);

  /**
   * The nearest stone this civilization has never laid eyes on, and the nearest it has. The first
   * is locked — the models are told nothing about the shape of the world they have not walked. The
   * second is the only stone a model could actually be reasoning about.
   */
  const stoneOutlook = useMemo(() => {
    const outlook = {} as Record<CivId, { known: number; knownAt?: number; unseenAt: number }>;
    for (const civ of ["north", "south"] as CivId[]) {
      const home = homeCentre(frame, civ);
      let known = 0;
      let knownAt: number | undefined;
      for (const node of frame.observedNodes[civ] ?? []) {
        const tile = tiles?.[node.z * RULES.width + node.x];
        if (tile?.node?.kind !== "stone" || node.amount <= 0) continue;
        known += node.amount;
        const away = Math.round(Math.hypot(node.x - home.x, node.z - home.z));
        knownAt = knownAt === undefined ? away : Math.min(knownAt, away);
      }
      let unseenAt = Infinity;
      if (tiles) {
        for (let z = 0; z < RULES.height; z += 1) {
          for (let x = 0; x < RULES.width; x += 1) {
            const index = z * RULES.width + x;
            if ((frame.fog[civ]?.[index] ?? 0) !== 0) continue;
            if (tiles[index]?.node?.kind !== "stone") continue;
            unseenAt = Math.min(unseenAt, Math.round(Math.hypot(x - home.x, z - home.z)));
          }
        }
      }
      outlook[civ] = { known, knownAt, unseenAt };
    }
    return outlook;
  }, [frame, tiles]);

  const hasUpkeep = hasUpkeepRule || pressure.some((row) => row.upkeepDue !== undefined);
  const upkeepFreeBlocks = structureUpkeepFreeBlocks(protocolVersion);

  const line = (civ: CivId, pick: (row: PressurePoint) => number | undefined) => ({
    key: civ,
    civ,
    dashed: civ === "south",
    points: pressure
      .filter((row) => row.civ === civ)
      .map((row) => [row.turn, pick(row)] as [number, number | undefined])
      .filter((point): point is [number, number] => point[1] !== undefined && point[1] !== null),
  });

  return (
    <section id="pressure" style={{ borderTop: `1px solid ${RULE}`, marginTop: 20, paddingTop: 16 }}>
      <Caption>
        {zh
          ? "同一個回合，兩個文明各自還撐得住多久，以及要補上缺口需要走多遠。全部都是引擎規則的除法，沒有評分，也沒有輸贏。"
          : "How long each civilization can hold at this turn, and how far it would have to walk to fix the shortfall. All of it is division on the engine's own rules — no score and no winner."}
      </Caption>

      {(["north", "south"] as CivId[]).map((civ) => {
        const stats = frame.civs[civ];
        const point = pressure.find((row) => row.civ === civ && row.turn === turn);
        const picked = harvest.find((row) => row.civ === civ && row.turn === turn);
        const foodIn = picked?.food ?? 0;
        const stoneIn = picked?.stone ?? 0;
        const foodDrain = stats.workers - foodIn;
        const foodTurns = runway(stats.food, foodDrain);
        const due = point?.upkeepDue ?? 0;
        const stoneTurns = hasUpkeep ? runway(stats.stone, due - stoneIn) : null;
        const home = facts?.civs[civ];
        const outlook = stoneOutlook[civ];
        const walkTurns = (tilesAway: number) => Math.ceil(tilesAway / RULES.workerMove);

        if (stats.workers === 0) {
          return (
            <div key={civ} style={{ marginBottom: 18 }}>
              <div style={{ color: CIV_COLOUR[civ], fontSize: 15, fontWeight: 600 }}>{civLabel(civ, lang)}</div>
              <div style={{ fontSize: 13, color: MUTED }}>
                {zh ? "已經沒有人。這一方的回合結束了。" : "No people left. This side's turns are over."}
              </div>
            </div>
          );
        }

        return (
          <div key={civ} style={{ marginBottom: 20 }}>
            <div style={{ color: CIV_COLOUR[civ], fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
              {civLabel(civ, lang)}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
              <Reading
                label={zh ? "食物續航" : "food runway"}
                tone={foodTurns === null ? "calm" : foodTurns > 20 ? "watch" : "alarm"}
                value={
                  foodTurns === null
                    ? zh
                      ? "收支平衡"
                      : "income covers it"
                    : zh
                      ? `${foodTurns} 回合`
                      : `${foodTurns} turns`
                }
                detail={
                  zh
                    ? `存糧 ${stats.food}｜${stats.workers} 人每回合吃 ${stats.workers}，本回合採到 ${foodIn}${foodDrain > 0 ? `，淨少 ${foodDrain}` : `，淨多 ${-foodDrain}`}。`
                    : `${stats.food} stored · ${stats.workers} people eat ${stats.workers} a turn and harvested ${foodIn}${foodDrain > 0 ? `, net −${foodDrain}` : `, net +${-foodDrain}`}.`
                }
              />

              {hasUpkeep ? (
                <Reading
                  label={zh ? "石材續航" : "stone runway"}
                  tone={stoneTurns === null ? "calm" : stoneTurns > 10 ? "watch" : "alarm"}
                  value={
                    due === 0
                      ? zh
                        ? "未開始收費"
                        : "not billed yet"
                      : stoneTurns === null
                        ? zh
                          ? "維護付得起"
                          : "upkeep is covered"
                        : zh
                          ? `${stoneTurns} 回合`
                          : `${stoneTurns} turns`
                  }
                  detail={
                    // With nothing billable the engine writes no upkeep line, so the completed-block
                    // total is genuinely unknown here. State the rule and the free allowance rather
                    // than print a number this panel does not have.
                    due === 0
                      ? zh
                        ? `存石 ${stats.stone}｜本季有結構維護：已完成建築超過 ${upkeepFreeBlocks} 塊後，每 ${RULES.structureUpkeepBlocks} 塊每回合要 1 石，付不出就拆自己的方塊，沒有回收。目前仍在免費額之內。`
                        : `${stats.stone} stored · this season charges structure upkeep: past ${upkeepFreeBlocks} completed blocks, every ${RULES.structureUpkeepBlocks} costs 1 stone a turn, and unpaid means the engine peels its own blocks with no salvage. Still inside the free allowance.`
                      : zh
                        ? `存石 ${stats.stone}｜已完成建築 ${point?.standingBlocks ?? 0} 塊，超出免費的 ${upkeepFreeBlocks} 塊後每 ${RULES.structureUpkeepBlocks} 塊每回合要 1 石，本回合要 ${due}${point?.blocksLost ? `，付不出而被拆掉 ${point.blocksLost} 塊` : ""}。`
                        : `${stats.stone} stored · ${point?.standingBlocks ?? 0} completed blocks; past the free ${upkeepFreeBlocks}, every ${RULES.structureUpkeepBlocks} costs 1 stone a turn — ${due} due this turn${point?.blocksLost ? `, and ${point.blocksLost} blocks were peeled off for non-payment` : ""}.`
                  }
                />
              ) : (
                <Reading
                  label={zh ? "石材" : "stone"}
                  tone={stats.stone > 30 ? "calm" : stats.stone > 0 ? "watch" : "alarm"}
                  value={zh ? `存石 ${stats.stone}` : `${stats.stone} stored`}
                  detail={
                    zh
                      ? "這一季的規則裡建築不需要持續維護，所以石材只在建造時消耗。"
                      : "Structures cost no continuing upkeep under this season's rules, so stone is only spent while building."
                  }
                />
              )}

              <Reading
                label={zh ? "再取得石材的成本" : "cost of reaching more stone"}
                tone={
                  outlook.known > 0
                    ? "calm"
                    : outlook.unseenAt === Infinity
                      ? "alarm"
                      : walkTurns(outlook.unseenAt) * 2 > (stoneTurns ?? foodTurns ?? 99)
                        ? "alarm"
                        : "watch"
                }
                value={
                  outlook.known > 0
                    ? zh
                      ? `已知還有 ${outlook.known} 石`
                      : `${outlook.known} stone already known`
                    : outlook.unseenAt === Infinity
                      ? zh
                        ? "地圖上再沒有石材"
                        : "no stone left anywhere"
                      : zh
                        ? `至少 ${walkTurns(outlook.unseenAt) * 2} 回合來回`
                        : `at least ${walkTurns(outlook.unseenAt) * 2} turns there and back`
                }
                detail={
                  outlook.known > 0
                    ? zh
                      ? `最近的一處在 ${outlook.knownAt} 格外，走過去約 ${walkTurns(outlook.knownAt ?? 0)} 回合。家門礦場尚餘 ${stats.quarryLeft}。`
                      : `The nearest is ${outlook.knownAt} tiles away, about ${walkTurns(outlook.knownAt ?? 0)} turns of walking. The home quarry holds ${stats.quarryLeft}.`
                    : zh
                      ? `他們見過的地方已經沒有石材了。最近一處未見過的在 ${outlook.unseenAt} 格外 🔒——但他們並不知道它在那裡，也不知道它存在。`
                      : `There is no stone left anywhere they have seen. The nearest unseen stone is ${outlook.unseenAt} tiles away 🔒 — but they do not know it is there, or that it exists.`
                }
              />

              <Reading
                label={zh ? "足跡" : "reach"}
                tone={(point?.beyondHome ?? 0) > 0 ? "calm" : "watch"}
                value={zh ? `最遠 ${point?.reach ?? 0} 格` : `${point?.reach ?? 0} tiles out`}
                detail={
                  // "Home fields regrow 0 a turn, feeding 0 people" is arithmetically right and
                  // tells a reader nothing. Where home has no income the sentence that belongs
                  // beside a reach figure is how far the nearest ground with one actually is.
                  zh
                    ? `${point?.beyondHome ?? 0} / ${point?.workers ?? stats.workers} 人在可建範圍（${RULES.buildRadius} 格）以外。${
                        home
                          ? home.homeRenews
                            ? `家園糧田每回合共再生 ${home.regen}，養得起 ${home.foodCeiling} 人；家門石材只夠再蓋 ${home.blocks} 格。`
                            : `家園糧田完全不會再生，合共只有 ${home.larder} 糧${home.nextRenewFood ? `；最近一塊會再生的糧地在 ${home.nextRenewFood} 格外，約 ${walkTurns(home.nextRenewFood)} 個回合腳程` : ""}。`
                          : ""
                      }`
                    : `${point?.beyondHome ?? 0} of ${point?.workers ?? stats.workers} people are beyond the ${RULES.buildRadius}-tile build radius.${
                        home
                          ? home.homeRenews
                            ? ` Home fields regrow ${home.regen} a turn, feeding ${home.foodCeiling} people; home stone buys only ${home.blocks} more cells.`
                            : ` Home fields regrow nothing and hold ${home.larder} food in total${home.nextRenewFood ? `; the nearest field that does regrow is ${home.nextRenewFood} tiles out, about ${walkTurns(home.nextRenewFood)} turns of walking` : ""}.`
                          : ""
                      }`
                }
              />
            </div>
          </div>
        );
      })}

      <Chart
        title={zh ? "最遠足跡（虛線＝可建範圍 12 格）" : "furthest person from home (dashed = the 12-tile build radius)"}
        note={zh ? "線平＝沒有人出過門" : "a flat line means nobody ever left"}
        series={[
          line("north", (row) => row.reach),
          line("south", (row) => row.reach),
          {
            key: "radius",
            civ: null,
            dashed: false,
            dotted: true,
            points: pressure
              .filter((row) => row.civ === "north")
              .map((row) => [row.turn, RULES.buildRadius] as [number, number]),
          },
        ]}
        turn={turn}
        maxTurn={maxTurn}
        onScrub={onScrub}
      />

      <Chart
        title={zh ? "在可建範圍以外的人數" : "people beyond the build radius"}
        note={zh ? "投入探索的人手" : "labour committed to going out"}
        series={[line("north", (row) => row.beyondHome), line("south", (row) => row.beyondHome)]}
        turn={turn}
        maxTurn={maxTurn}
        stepped
        onScrub={onScrub}
      />

      {pressure.some((row) => row.upkeepDue !== undefined) ? (
        <Chart
          title={zh ? "本回合結構維護要的石材" : "stone the structures demanded this turn"}
          note={zh ? "付不出就直接拆自己的方塊，沒有回收" : "unpaid, and the engine peels your own blocks with no salvage"}
          series={[line("north", (row) => row.upkeepDue), line("south", (row) => row.upkeepDue)]}
          turn={turn}
          maxTurn={maxTurn}
          stepped
          onScrub={onScrub}
        />
      ) : null}
    </section>
  );
}
