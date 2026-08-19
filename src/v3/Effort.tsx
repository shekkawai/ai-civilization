import { useEffect, useMemo, useState } from "react";
import { CIV_COLOUR } from "./BeliefMap";
import { Note } from "./RuleNote";
import { civLabel, useLang } from "./lang";
import type { CivId } from "../sim/types";

/**
 * What each side spent the whole season doing, in two pictures.
 *
 * The Worker Loom draws one lane per worker, which answers "what was *this person* doing" and is
 * exactly the wrong shape for "what was this civilization *for*". Ten lanes across 150 turns is
 * 1,500 cells; nobody reads a season out of that. Both charts here collapse the same rows into one
 * band per side, so the season has a silhouette:
 *
 * 1. **Where the hands went** — every worker sorted into its standing job, turn by turn. A civ that
 *    keeps four people idle for forty turns has a pale stripe across the middle of its band, and
 *    that stripe is v15's finding without anybody having to go looking for it.
 * 2. **What came off the map** — food and stone gathered, added up as the season runs. Slope is
 *    rate; the split between the two colours is the priority. A side that never turns green into
 *    grey never mined, and a flat top means the gathering stopped.
 *
 * Cumulative on purpose. A per-turn harvest chart is a noisy sawtooth — five here, nothing there,
 * ten when a party arrives — and the eye cannot integrate it. The running total is monotonic, so
 * the only thing left to read is the shape, which is the question being asked.
 *
 * None of this may ever reach a player. It describes the world and the allocation of people; it
 * never comments on a model's intentions.
 */

const RULE = "#ded5c4";
const INK = "#2b2723";
const MUTED = "#8a8172";

const FOOD = "#93a86a";
const STONE = "#8a8c93";

/** Same palette as the Loom, so a reader who learned it there does not have to learn it twice. */
const JOB_COLOUR: Record<string, string> = {
  gather: "#93a86a",
  deposit: "#c9a227",
  build: "#5f7fb0",
  repair: "#7d93b8",
  remove: "#b06a4f",
  move: "#c9c0ae",
  idle: "#e3ddd0",
};
const JOB_ORDER = ["gather", "deposit", "build", "repair", "remove", "move", "idle"];

interface Lane {
  turn: number;
  worker_id: string;
  civ: CivId;
  job: string;
}

interface HarvestRow {
  turn: number;
  civ: CivId;
  food: number;
  stone: number;
}

export function Effort({
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
  const { lang, t } = useLang();
  const zh = lang === "zh";
  const [lanes, setLanes] = useState<Lane[] | null>(null);
  const [harvest, setHarvest] = useState<HarvestRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/research/loom?seasonId=${encodeURIComponent(seasonId)}`, {
        headers: { Accept: "application/json" },
      }).then((response) => (response.ok ? response.json() : [])),
      fetch(`/api/research/harvest?seasonId=${encodeURIComponent(seasonId)}`, {
        headers: { Accept: "application/json" },
      }).then((response) => (response.ok ? response.json() : [])),
    ]).then(([laneRows, harvestRows]) => {
      if (cancelled) return;
      setLanes((laneRows as Lane[]) ?? []);
      setHarvest((harvestRows as HarvestRow[]) ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [seasonId]);

  const jobs = useMemo(() => (lanes ? jobBands(lanes, maxTurn) : null), [lanes, maxTurn]);
  const totals = useMemo(() => (harvest ? runningTotals(harvest, maxTurn) : null), [harvest, maxTurn]);

  if (!jobs || !totals) return null;

  const civs: CivId[] = ["north", "south"];
  const peak = Math.max(
    1,
    ...civs.flatMap((civ) => totals[civ].map((point) => point.food + point.stone)),
  );
  const mostPeople = Math.max(1, ...civs.flatMap((civ) => jobs[civ].map((column) => column.total)));

  return (
    <section style={{ borderTop: `1px solid ${RULE}`, marginTop: 20, paddingTop: 16 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: MUTED, textTransform: "uppercase" }}>
        {zh ? "整季走勢" : "the season at a glance"}
      </div>

      <h3 style={{ margin: "12px 0 2px", fontSize: 14, fontWeight: 600 }}>
        {zh ? "人手去了哪裡" : "Where the hands went"}
      </h3>
      <Note label={zh ? "怎樣看這條帶？" : "how to read this band"}>
        {zh
          ? "每一直條是一個回合，高度是當時的人數，顏色是每個人手上那份工作。整條帶就是這一季的人手怎麼分配——閒置是最淺那一層。"
          : "One column per turn, its height the population, its colours what each person was told to do. The whole band is how a season's labour was spent — idle is the palest layer."}
      </Note>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 14px", marginBottom: 8 }}>
        {JOB_ORDER.map((job) => (
          <span key={job} style={{ fontSize: 11, color: "#55524a", whiteSpace: "nowrap" }}>
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                background: JOB_COLOUR[job],
                border: "1px solid rgba(43,39,35,0.18)",
                marginRight: 5,
                verticalAlign: "-1px",
              }}
            />
            {t(`job_${job}` as never)}
          </span>
        ))}
        <span style={{ fontSize: 11, color: MUTED }}>
          {zh ? `兩條帶同一比例，滿格 = ${mostPeople} 人` : `both bands share one scale; full height = ${mostPeople} people`}
        </span>
      </div>
      {civs.map((civ) => (
        <JobBand
          key={civ}
          civ={civ}
          columns={jobs[civ]}
          mostPeople={mostPeople}
          turn={turn}
          maxTurn={maxTurn}
          onScrub={onScrub}
        />
      ))}

      <h3 style={{ margin: "18px 0 2px", fontSize: 14, fontWeight: 600 }}>
        {zh ? "累計採了多少" : "What came off the map"}
      </h3>
      <Note label={zh ? "怎樣看這條線？" : "how to read this line"}>
        {zh
          ? "由第一回合一路加起來的採集量，只算採到手，不扣吃掉或用掉的。斜率就是速度，兩種顏色的比例就是取捨；頂部變平代表採集停了。"
          : "Everything gathered, added up from turn one. Collection only — nothing is subtracted for eating or building. Slope is rate, the split between the colours is the trade-off, and a flat top means the gathering stopped."}
      </Note>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 14px", marginBottom: 8 }}>
        <Key colour={FOOD} label={zh ? "糧食" : "food"} />
        <Key colour={STONE} label={zh ? "石材" : "stone"} />
        {/* Both bands share one scale, so their heights are comparable — but without the top of
            that scale written down, a full band means nothing. */}
        <span style={{ fontSize: 11, color: MUTED }}>
          {zh ? `兩條帶同一比例，滿格 = ${peak}` : `both bands share one scale; full height = ${peak}`}
        </span>
      </div>
      {civs.map((civ) => (
        <HarvestBand
          key={civ}
          civ={civ}
          points={totals[civ]}
          peak={peak}
          turn={turn}
          maxTurn={maxTurn}
          onScrub={onScrub}
        />
      ))}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 22px", marginTop: 10 }}>
        {civs.map((civ) => {
          const last = totals[civ][Math.min(turn, totals[civ].length - 1)];
          if (!last) return null;
          const all = last.food + last.stone;
          return (
            <span key={civ} style={{ fontSize: 12, color: "#55524a" }}>
              <span style={{ color: CIV_COLOUR[civ] }}>{civLabel(civ, lang)}</span>{" "}
              {zh
                ? `到第 ${turn} 回合共採 ${all}：糧 ${last.food}、石 ${last.stone}`
                : `by turn ${turn}: ${all} gathered — ${last.food} food, ${last.stone} stone`}
              {all > 0
                ? zh
                  ? `（石佔 ${Math.round((last.stone / all) * 100)}%）`
                  : ` (${Math.round((last.stone / all) * 100)}% stone)`
                : null}
            </span>
          );
        })}
      </div>
    </section>
  );
}

function Key({ colour, label }: { colour: string; label: string }) {
  return (
    <span style={{ fontSize: 11, color: "#55524a" }}>
      <span
        style={{
          display: "inline-block",
          width: 10,
          height: 10,
          background: colour,
          border: "1px solid rgba(43,39,35,0.18)",
          marginRight: 5,
          verticalAlign: "-1px",
        }}
      />
      {label}
    </span>
  );
}

const BAND_HEIGHT = 62;

function JobBand({
  civ,
  columns,
  mostPeople,
  turn,
  maxTurn,
  onScrub,
}: {
  civ: CivId;
  columns: Array<{ turn: number; total: number; counts: Record<string, number> }>;
  mostPeople: number;
  turn: number;
  maxTurn: number;
  onScrub: (turn: number) => void;
}) {
  const { lang } = useLang();
  const width = Math.max(1, maxTurn + 1);
  return (
    <Frame civ={civ} turn={turn} width={width} onScrub={onScrub}>
      {columns.map((column) => {
        let offset = 0;
        return JOB_ORDER.map((job) => {
          const count = column.counts[job] ?? 0;
          if (count === 0) return null;
          const y = offset;
          offset += count;
          return (
            <rect
              key={`${column.turn}-${job}`}
              x={column.turn}
              y={BAND_HEIGHT - ((y + count) / mostPeople) * BAND_HEIGHT}
              width={1}
              height={(count / mostPeople) * BAND_HEIGHT}
              fill={JOB_COLOUR[job]}
              shapeRendering="crispEdges"
            >
              <title>
                {lang === "zh"
                  ? `第 ${column.turn} 回合 · ${job} × ${count}`
                  : `turn ${column.turn} · ${job} × ${count}`}
              </title>
            </rect>
          );
        });
      })}
    </Frame>
  );
}

function HarvestBand({
  civ,
  points,
  peak,
  turn,
  maxTurn,
  onScrub,
}: {
  civ: CivId;
  points: Array<{ turn: number; food: number; stone: number }>;
  peak: number;
  turn: number;
  maxTurn: number;
  onScrub: (turn: number) => void;
}) {
  const width = Math.max(1, maxTurn + 1);
  const y = (value: number) => BAND_HEIGHT - (value / peak) * BAND_HEIGHT;
  const area = (top: (point: (typeof points)[number]) => number) =>
    `M0,${BAND_HEIGHT} ` +
    points.map((point) => `L${point.turn},${y(top(point))}`).join(" ") +
    ` L${points[points.length - 1]?.turn ?? 0},${BAND_HEIGHT} Z`;

  return (
    <Frame civ={civ} turn={turn} width={width} onScrub={onScrub}>
      <path d={area((point) => point.food + point.stone)} fill={STONE} />
      <path d={area((point) => point.food)} fill={FOOD} />
    </Frame>
  );
}

/**
 * One band, clickable to scrub. The SVG viewBox is one unit per turn so every child can be written
 * in turn coordinates and the whole thing rescales with the container — no pixel maths anywhere.
 */
function Frame({
  civ,
  turn,
  width,
  onScrub,
  children,
}: {
  civ: CivId;
  turn: number;
  width: number;
  onScrub: (turn: number) => void;
  children: React.ReactNode;
}) {
  const { lang } = useLang();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
      <span style={{ fontSize: 11, color: CIV_COLOUR[civ], flex: "0 0 auto", width: 46 }}>
        {civLabel(civ, lang)}
      </span>
      {/* `flex: 1` alone is not enough: an SVG has an intrinsic 300px width, which becomes the
          flex base and overruns any track narrower than that — which is every phone. The band was
          being drawn off the right edge of the screen. */}
      <svg
        viewBox={`0 0 ${width} ${BAND_HEIGHT}`}
        preserveAspectRatio="none"
        style={{
          flex: "1 1 0",
          minWidth: 0,
          width: "100%",
          height: BAND_HEIGHT,
          border: `1px solid ${RULE}`,
          cursor: "pointer",
          display: "block",
        }}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          onScrub(Math.round(((event.clientX - rect.left) / rect.width) * width));
        }}
      >
        {children}
        <line x1={turn} x2={turn} y1={0} y2={BAND_HEIGHT} stroke={INK} strokeWidth={width / 300} />
      </svg>
    </div>
  );
}

/** One column per turn per civ: how many people held each job at the end of it. */
function jobBands(lanes: Lane[], maxTurn: number) {
  const bands: Record<CivId, Array<{ turn: number; total: number; counts: Record<string, number> }>> = {
    north: [],
    south: [],
  };
  const byTurn: Record<CivId, Map<number, Record<string, number>>> = { north: new Map(), south: new Map() };
  for (const lane of lanes) {
    const map = byTurn[lane.civ];
    if (!map) continue;
    const counts = map.get(lane.turn) ?? {};
    counts[lane.job] = (counts[lane.job] ?? 0) + 1;
    map.set(lane.turn, counts);
  }
  for (const civ of ["north", "south"] as CivId[]) {
    for (let index = 0; index <= maxTurn; index += 1) {
      const counts = byTurn[civ].get(index);
      if (!counts) continue;
      bands[civ].push({
        turn: index,
        counts,
        total: Object.values(counts).reduce((sum, value) => sum + value, 0),
      });
    }
  }
  return bands;
}

/**
 * Running totals, carried forward across turns with no harvest row.
 *
 * A turn where nobody gathered produces no row at all, and a line drawn straight from the previous
 * row to the next would slope through the gap — reading as slow steady work where there was in fact
 * none. Holding the value flat draws the stall.
 */
function runningTotals(rows: HarvestRow[], maxTurn: number) {
  const totals: Record<CivId, Array<{ turn: number; food: number; stone: number }>> = { north: [], south: [] };
  const byTurn: Record<CivId, Map<number, { food: number; stone: number }>> = { north: new Map(), south: new Map() };
  for (const row of rows) {
    const map = byTurn[row.civ];
    if (!map) continue;
    const current = map.get(row.turn) ?? { food: 0, stone: 0 };
    map.set(row.turn, { food: current.food + (row.food ?? 0), stone: current.stone + (row.stone ?? 0) });
  }
  for (const civ of ["north", "south"] as CivId[]) {
    let food = 0;
    let stone = 0;
    for (let index = 0; index <= maxTurn; index += 1) {
      const entry = byTurn[civ].get(index);
      food += entry?.food ?? 0;
      stone += entry?.stone ?? 0;
      totals[civ].push({ turn: index, food, stone });
    }
  }
  return totals;
}
