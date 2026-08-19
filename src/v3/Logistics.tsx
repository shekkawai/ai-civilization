import { useEffect, useMemo, useState } from "react";
import { CIV_COLOUR } from "./BeliefMap";
import { Note } from "./RuleNote";
import { civLabel, useLang } from "./lang";
import { RULES } from "../sim/config";
import type { CivId } from "../sim/types";

/**
 * What the labour physically did, and whether goods got home — as pictures over people and time.
 *
 * This section deliberately carries no cumulative KPI numbers. It used to open with four stat
 * cards (genuinely idle, travel/waiting, peak backpack pressure, peak storage fill), and three of
 * them restated what the labour band directly below and the Efficiency panel further down already
 * said — a reader met "idle" four times on one page. The division now is: the **Efficiency**
 * panel owns the cumulative comparisons and the idle attribution; this section owns the shapes —
 * the four-way physical classification band and the backlog curve — plus the one figure nothing
 * else states, peak storage fill, printed as a caption under the chart it belongs to.
 */

const RULE = "#ded5c4";
const MUTED = "#8a8172";
const INK = "#2b2723";
const WORK = "#93a86a";
const TRANSIT = "#c9b171";
const NEW = "#9bb1c8";
const IDLE = "#e3ddd0";

interface Point {
  turn: number;
  civ: CivId;
  workers: number;
  productive: number;
  transit: number;
  idle: number;
  newWorkers: number;
  carried: number;
  fullPacks: number;
  storageUsed: number;
  storageCapacity: number;
}

interface Store {
  id: string;
  civ: CivId;
  turn: number;
  x: number;
  z: number;
  capacity: number;
  oasisDistance: number | null;
}

interface Payload {
  points: Point[];
  stores: Store[];
}

interface Totals {
  workerTurns: number;
  productive: number;
  transit: number;
  idle: number;
  newWorkers: number;
  fullPacks: number;
  peakPack: number;
  peakStorage: number;
}

export function Logistics({
  seasonId,
  turn,
  maxTurn,
  onScrub,
}: {
  seasonId: string;
  turn: number;
  maxTurn: number;
  onScrub: (turn: number) => void;
}) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const narrow = useNarrow();
  const [payload, setPayload] = useState<Payload | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/research/logistics?seasonId=${encodeURIComponent(seasonId)}`, {
      headers: { Accept: "application/json" },
    })
      .then((response) => (response.ok ? response.json() : { points: [], stores: [] }))
      .then((data) => {
        if (!cancelled) setPayload(data as Payload);
      });
    return () => {
      cancelled = true;
    };
  }, [seasonId]);

  const visible = useMemo(
    () => payload?.points.filter((point) => point.turn <= turn) ?? [],
    [payload, turn],
  );
  const stores = useMemo(
    () => payload?.stores.filter((store) => store.turn <= turn) ?? [],
    [payload, turn],
  );
  const totals = useMemo(() => summarize(visible), [visible]);

  if (!payload || visible.length === 0) return null;

  return (
    <section style={{ borderTop: `1px solid ${RULE}`, marginTop: 20, paddingTop: 16 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: MUTED, textTransform: "uppercase" }}>
        {zh ? "資源與物流" : "resources and logistics"}
      </div>
      <h3 style={{ margin: "10px 0 4px", fontSize: 18, fontWeight: 600 }}>
        {zh ? "人手是否用在工作，物資是否卡在路上" : "Whether labour worked and goods got home"}
      </h3>
      <p style={{ margin: "0 0 12px", maxWidth: "82ch", fontSize: 12.5, lineHeight: 1.7, color: "#55524a" }}>
        {zh
          ? `累計至第 ${turn} 回合。這裡按工人真正發生的移動和引擎結果分類，不再把「回合完結時回到 idle」誤當成整回合閒置。`
          : `Cumulative through turn ${turn}. This classifies physical movement and engine outcomes, rather than mistaking an end-of-turn idle state for a whole turn wasted.`}
      </p>

      <h4 style={{ margin: "0 0 7px", fontSize: 14, fontWeight: 600 }}>
        {zh ? "人力實際分配" : "What the labour actually did"}
      </h4>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 14px", marginBottom: 8 }}>
        <Key colour={WORK} label={zh ? "有完成工作" : "completed work"} />
        <Key colour={TRANSIT} label={zh ? "運送／等候／受阻" : "travel / wait / blocked"} />
        <Key colour={NEW} label={zh ? "本回合新加入" : "joined this turn"} />
        <Key colour={IDLE} label={zh ? "真正閒置" : "genuinely idle"} />
      </div>
      {(["north", "south"] as CivId[]).map((civ) => (
        <LabourBar key={civ} civ={civ} totals={totals[civ]} lang={lang} />
      ))}
      <Note label={zh ? "怎樣分辨閒置？" : "what counts as idle?"}>
        {zh
          ? "有完成採集、卸貨、建造等結果，算有完成工作；移動中、仍有工作指令、等待材料，或實際被另一人阻擋，算運送／等候；新加入的人另列。只有沒有移動、沒有任何工作結果、沒有工作指令，而且不是新加入，才算真正閒置。"
          : "A completed gather, delivery, build or other job counts as completed work. Moving, holding an active job, waiting for material, or being physically blocked counts as travel/waiting. New arrivals are separate. Only no movement, no job outcome, no active job and no arrival counts as genuinely idle."}
      </Note>

      <h4 style={{ margin: "20px 0 4px", fontSize: 14, fontWeight: 600 }}>
        {zh ? "背包積壓與 Store 完成時間" : "Backpack backlog and Store completions"}
      </h4>
      <p style={{ margin: "0 0 7px", fontSize: 11.5, lineHeight: 1.6, color: MUTED }}>
        {zh
          ? `曲線 = 所有人背包物資 ÷ 當時人口可攜帶的 ${RULES.carry} 格。文明歸零時曲線回到 0；菱形是 Store 完成回合。`
          : `Line = all carried goods ÷ ${RULES.carry} slots per living worker. It returns to zero when a civilization has no people; diamonds mark Store completion turns.`}
      </p>
      <BackpackChart
        points={visible}
        stores={stores}
        turn={turn}
        maxTurn={maxTurn}
        onScrub={onScrub}
        zh={zh}
        narrow={narrow}
      />
      <p style={{ margin: "6px 0 0", fontSize: 11.5, color: MUTED }}>
        {zh
          ? `倉位使用高峰（所有本地倉庫合計）：北岸 ${Math.round(totals.north.peakStorage)}% · 南原 ${Math.round(totals.south.peakStorage)}%`
          : `Peak storage fill, all local stores combined: north ${Math.round(totals.north.peakStorage)}% · south ${Math.round(totals.south.peakStorage)}%`}
      </p>

      {stores.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(205px, 1fr))", gap: 7, marginTop: 9 }}>
          {stores.map((store, index) => (
            <button
              key={`${store.id}-${store.turn}`}
              type="button"
              onClick={() => onScrub(store.turn)}
              style={{
                appearance: "none",
                textAlign: "left",
                border: `1px solid ${RULE}`,
                borderLeft: `3px solid ${CIV_COLOUR[store.civ]}`,
                borderRadius: 5,
                background: "#fffdf8",
                color: INK,
                padding: "8px 9px",
                cursor: "pointer",
                font: "inherit",
              }}
            >
              <span style={{ display: "block", fontSize: 12.5, fontWeight: 600 }}>
                {civLabel(store.civ, lang)} · Store {indexForCiv(stores, store, index)} · T{store.turn}
              </span>
              <span style={{ display: "block", marginTop: 2, fontSize: 11.5, color: MUTED }}>
                ({store.x}, {store.z}) · {store.capacity} {zh ? "格倉位" : "storage slots"}
                {store.oasisDistance === null
                  ? ""
                  : zh
                    ? ` · 可卸貨位置距綠洲 ${store.oasisDistance} 格`
                    : ` · unloading access ${store.oasisDistance} tiles from Oasis`}
              </span>
            </button>
          ))}
        </div>
      )}
      {stores.some((store) => store.oasisDistance === 0) && (
        <p style={{ margin: "7px 0 0", fontSize: 11.5, lineHeight: 1.55, color: MUTED }}>
          {zh
            ? "距離 0 代表工人站在綠洲採集格時，已同時站在該 Store 的可卸貨位置；不是兩座設施重疊。"
            : "Distance 0 means a worker standing on an Oasis gathering tile is already on that Store's unloading access; the structures do not overlap."}
        </p>
      )}
    </section>
  );
}

function summarize(points: Point[]): Record<CivId, Totals> {
  const result: Record<CivId, Totals> = {
    north: { workerTurns: 0, productive: 0, transit: 0, idle: 0, newWorkers: 0, fullPacks: 0, peakPack: 0, peakStorage: 0 },
    south: { workerTurns: 0, productive: 0, transit: 0, idle: 0, newWorkers: 0, fullPacks: 0, peakPack: 0, peakStorage: 0 },
  };
  for (const point of points) {
    const row = result[point.civ];
    const turns = point.productive + point.transit + point.idle + point.newWorkers;
    row.workerTurns += turns;
    row.productive += point.productive;
    row.transit += point.transit;
    row.idle += point.idle;
    row.newWorkers += point.newWorkers;
    row.fullPacks += point.fullPacks;
    row.peakPack = Math.max(row.peakPack, backpackPercent(point));
    row.peakStorage = Math.max(
      row.peakStorage,
      point.storageCapacity > 0 ? (100 * point.storageUsed) / point.storageCapacity : 0,
    );
  }
  return result;
}

function backpackPercent(point: Point) {
  return point.workers > 0 ? Math.min(100, (100 * point.carried) / (point.workers * RULES.carry)) : 0;
}

function LabourBar({ civ, totals, lang }: { civ: CivId; totals: Totals; lang: "zh" | "en" }) {
  const parts = [
    { key: "productive", value: totals.productive, colour: WORK },
    { key: "transit", value: totals.transit, colour: TRANSIT },
    { key: "new", value: totals.newWorkers, colour: NEW },
    { key: "idle", value: totals.idle, colour: IDLE },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "72px 1fr 52px", gap: 8, alignItems: "center", margin: "7px 0" }}>
      <span style={{ fontSize: 11.5, color: CIV_COLOUR[civ] }}>{civLabel(civ, lang)}</span>
      <div style={{ display: "flex", height: 18, border: `1px solid ${RULE}`, borderRadius: 3, overflow: "hidden", background: "#f4efe5" }}>
        {parts.map((part) => (
          <span
            key={part.key}
            style={{ width: `${totals.workerTurns > 0 ? (100 * part.value) / totals.workerTurns : 0}%`, background: part.colour }}
            title={`${part.key}: ${part.value}`}
          />
        ))}
      </div>
      <span style={{ textAlign: "right", fontSize: 10.5, color: MUTED }}>{totals.workerTurns}</span>
    </div>
  );
}

function BackpackChart({
  points,
  stores,
  turn,
  maxTurn,
  onScrub,
  zh,
  narrow,
}: {
  points: Point[];
  stores: Store[];
  turn: number;
  maxTurn: number;
  onScrub: (turn: number) => void;
  zh: boolean;
  narrow: boolean;
}) {
  const width = narrow ? 350 : 900;
  const height = narrow ? 184 : 154;
  const left = narrow ? 30 : 34;
  const right = narrow ? 7 : 10;
  const top = 8;
  const bottom = 22;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (value: number) => left + (Math.max(0, value) / Math.max(1, maxTurn)) * plotWidth;
  const y = (value: number) => top + ((100 - Math.max(0, Math.min(100, value))) / 100) * plotHeight;
  const civPoints = (civ: CivId) => points.filter((point) => point.civ === civ).sort((a, b) => a.turn - b.turn);
  const path = (civ: CivId) =>
    civPoints(civ)
      .map((point, index) => `${index === 0 ? "M" : "L"}${x(point.turn)},${y(backpackPercent(point))}`)
      .join(" ");
  const valueAt = (civ: CivId, targetTurn: number) => {
    const point = civPoints(civ).find((entry) => entry.turn === targetTurn);
    return point ? backpackPercent(point) : 0;
  };

  return (
    <div style={{ border: `1px solid ${RULE}`, borderRadius: 5, background: "#fffdf8", overflow: "hidden" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={zh ? "背包積壓折線圖" : "Backpack backlog line chart"}
        style={{ display: "block", width: "100%", minHeight: narrow ? 184 : 150 }}
      >
        {[0, 50, 100].map((level) => (
          <g key={level}>
            <line x1={left} y1={y(level)} x2={width - right} y2={y(level)} stroke={RULE} strokeDasharray={level === 0 ? undefined : "3 4"} />
            <text x={left - 6} y={y(level) + 4} textAnchor="end" fontSize="10" fill={MUTED}>{level}%</text>
          </g>
        ))}
        {(["north", "south"] as CivId[]).map((civ) => (
          <path key={civ} d={path(civ)} fill="none" stroke={CIV_COLOUR[civ]} strokeWidth="2.4" strokeLinejoin="round" />
        ))}
        {stores.map((store) => {
          const cx = x(store.turn);
          const cy = y(valueAt(store.civ, store.turn));
          return (
            <g key={`${store.id}-${store.turn}`} role="button" tabIndex={0} onClick={() => onScrub(store.turn)} style={{ cursor: "pointer" }}>
              <line x1={cx} y1={top} x2={cx} y2={top + plotHeight} stroke={CIV_COLOUR[store.civ]} strokeOpacity="0.2" />
              <path d={`M${cx},${cy - 6} L${cx + 6},${cy} L${cx},${cy + 6} L${cx - 6},${cy} Z`} fill={CIV_COLOUR[store.civ]} stroke="#fffdf8" strokeWidth="1.5">
                <title>{`Store · turn ${store.turn} · (${store.x}, ${store.z})`}</title>
              </path>
            </g>
          );
        })}
        <line x1={x(turn)} y1={top} x2={x(turn)} y2={top + plotHeight} stroke={INK} strokeWidth="1" />
        <text x={x(turn)} y={height - 5} textAnchor={turn > maxTurn * 0.9 ? "end" : "middle"} fontSize="10" fill={INK}>T{turn}</text>
        <text x={left} y={height - 5} fontSize="10" fill={MUTED}>T0</text>
        <text x={width - right} y={height - 5} textAnchor="end" fontSize="10" fill={MUTED}>T{maxTurn}</text>
      </svg>
      <div style={{ display: "flex", gap: 15, padding: "0 10px 8px", fontSize: 11, color: MUTED }}>
        <Key colour={CIV_COLOUR.north} label={zh ? "北面" : "north"} line />
        <Key colour={CIV_COLOUR.south} label={zh ? "南面" : "south"} line />
        <span>{zh ? "◆ Store 完成" : "◆ Store completed"}</span>
      </div>
    </div>
  );
}

function Key({ colour, label, line = false }: { colour: string; label: string; line?: boolean }) {
  return (
    <span style={{ fontSize: 11, color: "#55524a", whiteSpace: "nowrap" }}>
      <span
        style={{
          display: "inline-block",
          width: 11,
          height: line ? 2 : 10,
          background: colour,
          border: line ? undefined : "1px solid rgba(43,39,35,0.18)",
          marginRight: 5,
          verticalAlign: line ? "3px" : "-1px",
        }}
      />
      {label}
    </span>
  );
}

function indexForCiv(stores: Store[], target: Store, fallback: number) {
  const index = stores.filter((store) => store.civ === target.civ && store.turn <= target.turn).indexOf(target);
  return index >= 0 ? index + 1 : fallback + 1;
}

function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 640);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 640);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return narrow;
}
