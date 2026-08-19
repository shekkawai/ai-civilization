import { useEffect, useState } from "react";
import { CIV_COLOUR } from "./BeliefMap";
import { Caption } from "./RuleNote";
import { useLang } from "./lang";
import { useNarrow } from "./responsive";
import type { CivId } from "../sim/types";

/**
 * Small multiples on one shared turn axis, with the playhead drawn through every one of them at
 * once. That is what makes several charts read as a single instrument rather than several widgets.
 *
 * North is solid and south is dashed everywhere in the app, so a reader learns the convention once.
 * The series come from `turn_stats`, which is one small query for a whole season — the stored
 * worlds are never decoded to draw these.
 */

export interface SeriesPoint {
  turn: number;
  civs: Record<
    CivId,
    {
      workers: number;
      food: number;
      stone: number;
      blocksPlaced: number;
      /** Stone still in the ground at the home quarry. It never regrows, so this only falls. */
      quarryLeft?: number;
      seenTiles?: number;
      nearestGap?: number;
      migrationFoodRequired?: number;
    }
  >;
}

export interface HarvestRow {
  turn: number;
  civ: CivId;
  food: number;
  stone: number;
}

const INK = "#2b2723";
const RULE = "#ded5c4";
const MUTED = "#8a8172";

function path(points: Array<[number, number]>, stepped: boolean) {
  if (points.length === 0) return "";
  const parts = [`M ${points[0][0]} ${points[0][1]}`];
  for (let index = 1; index < points.length; index += 1) {
    const [x, y] = points[index];
    if (stepped) parts.push(`L ${x} ${points[index - 1][1]}`);
    parts.push(`L ${x} ${y}`);
  }
  return parts.join(" ");
}

/** Exported so the pressure panel draws on the same axis and the same conventions as every other
 *  chart — north solid, south dashed, playhead through all of them. */
export function Chart({
  title,
  note,
  series,
  turn,
  maxTurn,
  stepped = false,
  onScrub,
}: {
  title: string;
  note?: string;
  series: Array<{
    key: string;
    civ: CivId | null;
    dashed: boolean;
    dotted?: boolean;
    points: Array<[number, number]>;
  }>;
  turn: number;
  maxTurn: number;
  stepped?: boolean;
  onScrub: (turn: number) => void;
}) {
  const narrow = useNarrow();
  const width = 1000;
  const height = 84;
  const values = series.flatMap((line) => line.points.map(([, value]) => value));
  const top = Math.max(1, Math.max(...values, 0));
  const x = (t: number) => (maxTurn > 0 ? (t / maxTurn) * width : 0);
  const y = (value: number) => height - (value / top) * (height - 8) - 2;

  /**
   * A chart with no numbers on it is a shape, not a measurement. Rather than a full axis — which
   * would cost a third of the height these small multiples have — each line prints its value at the
   * playhead, and the scale prints its ceiling. Between them a reader can place any point.
   */
  const atPlayhead: Array<{ key: string; civ: CivId | null; value: number; dotted?: boolean }> = [];
  for (const line of series) {
    let best: [number, number] | undefined;
    for (const point of line.points) {
      if (point[0] <= turn && (!best || point[0] > best[0])) best = point;
    }
    if (best) atPlayhead.push({ key: line.key, civ: line.civ, value: best[1], dotted: line.dotted });
  }

  return (
    <div style={{ marginBottom: 14 }}>
      {/* On a phone the title, the scale, up to three readings and a note did not fit on one line,
          so the last reading was cut off the right edge — on a chart whose numbers are the only
          thing making it a measurement rather than a shape. Below the breakpoint the title takes its
          own line and the readings wrap under it. */}
      <div
        style={{
          display: "flex",
          flexDirection: narrow ? "column" : "row",
          justifyContent: "space-between",
          alignItems: narrow ? "stretch" : "baseline",
          gap: narrow ? 1 : 12,
        }}
      >
        <div style={{ fontSize: 11, letterSpacing: "0.08em", color: MUTED, textTransform: "uppercase" }}>
          {title}
        </div>
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "baseline",
            flexWrap: "wrap",
            justifyContent: narrow ? "flex-start" : "flex-end",
          }}
        >
          <span style={{ fontSize: 10, color: MUTED }}>0 – {top}</span>
          {atPlayhead.map((entry) => (
            <span
              key={entry.key}
              style={{
                fontSize: 13,
                fontVariantNumeric: "tabular-nums",
                color: entry.civ ? CIV_COLOUR[entry.civ] : MUTED,
                fontStyle: entry.dotted ? "italic" : undefined,
              }}
            >
              {entry.value}
            </span>
          ))}
          {note && !narrow ? <span style={{ fontSize: 11, color: MUTED }}>{note}</span> : null}
        </div>
      </div>
      {note && narrow ? (
        <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.5, margin: "1px 0 2px" }}>{note}</div>
      ) : null}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height, display: "block", cursor: "crosshair" }}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          onScrub(Math.round(((event.clientX - rect.left) / rect.width) * maxTurn));
        }}
      >
        <line x1={0} y1={height - 2} x2={width} y2={height - 2} stroke={RULE} strokeWidth={1} />
        <line x1={0} y1={y(top)} x2={width} y2={y(top)} stroke={RULE} strokeWidth={1} strokeDasharray="2 6" />
        {series.map((line) => (
          <path
            key={line.key}
            d={path(line.points.map(([t, value]) => [x(t), y(value)]), stepped)}
            fill="none"
            stroke={line.civ ? CIV_COLOUR[line.civ] : MUTED}
            strokeWidth={1.4}
            strokeDasharray={line.dotted ? "1 4" : line.dashed ? "5 4" : undefined}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <line x1={x(turn)} y1={0} x2={x(turn)} y2={height} stroke={INK} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

export function Charts({
  seasonId,
  series,
  turn,
  maxTurn,
  onScrub,
}: {
  seasonId: string;
  /** Fetched once by the page, because the turn summary reads the same rows for its deltas. */
  series: SeriesPoint[] | null;
  turn: number;
  maxTurn: number;
  onScrub: (turn: number) => void;
}) {
  const { t } = useLang();
  const [harvest, setHarvest] = useState<HarvestRow[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/research/harvest?seasonId=${encodeURIComponent(seasonId)}`, {
      headers: { Accept: "application/json" },
    })
      .then((response) => (response.ok ? response.json() : []))
      .then((payload) => {
        if (!cancelled) setHarvest((payload as HarvestRow[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [seasonId]);

  if (!series || series.length === 0) return null;

  const line = (civ: CivId, pick: (entry: SeriesPoint["civs"][CivId]) => number | undefined) => ({
    key: `${civ}`,
    civ,
    dashed: civ === "south",
    points: series
      .map((entry) => [entry.turn, pick(entry.civs[civ])] as [number, number | undefined])
      .filter((point): point is [number, number] => point[1] !== undefined && point[1] !== null),
  });

  return (
    <section style={{ borderTop: `1px solid ${RULE}`, marginTop: 20, paddingTop: 16 }}>
      <Caption>{t("capCharts")}</Caption>
      <Chart
        title={t("chartPopulation")}
        series={[line("north", (civ) => civ.workers), line("south", (civ) => civ.workers)]}
        turn={turn}
        maxTurn={maxTurn}
        stepped
        onScrub={onScrub}
      />
      <Chart
        title={t("chartFood")}
        note={t("chartFoodNote")}
        series={[
          line("north", (civ) => civ.food),
          line("south", (civ) => civ.food),
          // The bar a civilization has to clear for the next adult to join. It rises with
          // population, so the reader watches the target move away from them. Dotted, because
          // dashed already means "south" everywhere else on the page.
          {
            ...line("north", (civ) => civ.migrationFoodRequired),
            key: "threshold-north",
            dashed: false,
            dotted: true,
            civ: null,
          },
        ]}
        turn={turn}
        maxTurn={maxTurn}
        onScrub={onScrub}
      />
      {/* Promoted out of the "more" drawer: the home quarry is the one number on this page that can
          only fall, and the turn it reaches zero is the turn the map starts pushing outward. A
          reader who sees nothing else should see this line hit the floor. */}
      <Chart
        title={t("chartQuarry")}
        note={t("chartQuarryNote")}
        series={[line("north", (civ) => civ.quarryLeft), line("south", (civ) => civ.quarryLeft)]}
        turn={turn}
        maxTurn={maxTurn}
        onScrub={onScrub}
      />
      <Chart
        title={`${t("chartSeen")} 🔒`}
        series={[line("north", (civ) => civ.seenTiles), line("south", (civ) => civ.seenTiles)]}
        turn={turn}
        maxTurn={maxTurn}
        onScrub={onScrub}
      />
      {expanded ? (
        <>
          <Chart
            title={t("chartStone")}
            series={[line("north", (civ) => civ.stone), line("south", (civ) => civ.stone)]}
            turn={turn}
            maxTurn={maxTurn}
            onScrub={onScrub}
          />
          <Chart
            title={t("chartHarvest")}
            note={t("chartHarvestNote")}
            series={[
              {
                key: "harvest-north",
                civ: "north",
                dashed: false,
                points: harvest
                  .filter((row) => row.civ === "north")
                  .map((row) => [row.turn, row.food + row.stone] as [number, number]),
              },
              {
                key: "harvest-south",
                civ: "south",
                dashed: true,
                points: harvest
                  .filter((row) => row.civ === "south")
                  .map((row) => [row.turn, row.food + row.stone] as [number, number]),
              },
            ]}
            turn={turn}
            maxTurn={maxTurn}
            onScrub={onScrub}
          />
          <Chart
            title={t("chartBlocks")}
            series={[line("north", (civ) => civ.blocksPlaced), line("south", (civ) => civ.blocksPlaced)]}
            turn={turn}
            maxTurn={maxTurn}
            onScrub={onScrub}
          />
          <Chart
            title={t("chartGap")}
            note={t("chartGapNote")}
            series={[
              {
                key: "gap",
                civ: null,
                dashed: false,
                points: series
                  .map((entry) => [entry.turn, entry.civs.north.nearestGap] as [number, number | undefined])
                  .filter((point): point is [number, number] => point[1] !== undefined && point[1] !== null),
              },
            ]}
            turn={turn}
            maxTurn={maxTurn}
            onScrub={onScrub}
          />
        </>
      ) : null}
      <button
        onClick={() => setExpanded((value) => !value)}
        style={{
          border: `1px solid ${RULE}`,
          background: "transparent",
          color: INK,
          padding: "3px 9px",
          fontSize: 11,
          cursor: "pointer",
        }}
      >
        {expanded ? t("less") : t("more")}
      </button>
    </section>
  );
}
