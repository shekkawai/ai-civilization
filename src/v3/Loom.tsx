import { useEffect, useMemo, useState } from "react";
import { useLang } from "./lang";
import { Caption } from "./RuleNote";
import { useNarrow } from "./responsive";
import type { CivId } from "../sim/types";

/**
 * The Worker Loom — one horizontal lane per worker across the whole season, coloured by what that
 * worker was doing on each turn. Six to eighteen workers is few enough to name, and eighteen lanes
 * across 150 turns is a complete portrait of an economy: a wall of gather-green with no deposits is
 * v14's collapse, and a lane that goes flat at turn 6 and never changes again is a sealed worker.
 *
 * `job` is the standing order the worker held; `did` is what the engine recorded for it. A worker
 * walking to a distant tile produces no result at all, which is why walking is drawn from the job
 * and never inferred from silence.
 */

export interface Lane {
  turn: number;
  worker_id: string;
  civ: CivId;
  job: string;
  load: number;
  did: string | null;
}

const RULE = "#ded5c4";
const INK = "#2b2723";

const JOB_COLOUR: Record<string, string> = {
  idle: "#e3ddd0",
  move: "#c9c0ae",
  gather: "#93a86a",
  deposit: "#c9a227",
  build: "#5f7fb0",
  repair: "#7d93b8",
  remove: "#b06a4f",
};

const JOB_KEYS = ["gather", "deposit", "build", "repair", "remove", "move", "idle"];

export function Loom({
  seasonId,
  turn,
  maxTurn,
  onScrub,
  onSelectWorker,
  selectedWorker,
}: {
  seasonId: string;
  turn: number;
  maxTurn: number;
  onScrub: (turn: number) => void;
  onSelectWorker: (workerId: string) => void;
  selectedWorker?: string;
}) {
  const { t, lang } = useLang();
  const narrow = useNarrow();
  const [lanes, setLanes] = useState<Lane[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/research/loom?seasonId=${encodeURIComponent(seasonId)}`, {
      headers: { Accept: "application/json" },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!cancelled) setLanes(payload as Lane[] | null);
      });
    return () => {
      cancelled = true;
    };
  }, [seasonId]);

  const byWorker = useMemo(() => {
    const map = new Map<string, { civ: CivId; cells: Map<number, Lane> }>();
    for (const lane of lanes ?? []) {
      let entry = map.get(lane.worker_id);
      if (!entry) {
        entry = { civ: lane.civ, cells: new Map() };
        map.set(lane.worker_id, entry);
      }
      entry.cells.set(lane.turn, lane);
    }
    // Born-order within a side, north first, so the two blocks read as two economies.
    return [...map.entries()].sort(([leftId, left], [rightId, right]) => {
      if (left.civ !== right.civ) return left.civ === "north" ? -1 : 1;
      return Number(leftId.split("w")[1]) - Number(rightId.split("w")[1]);
    });
  }, [lanes]);

  if (!lanes || byWorker.length === 0) return null;

  const columns = Math.max(1, maxTurn);

  return (
    <section style={{ borderTop: `1px solid ${RULE}`, marginTop: 20, paddingTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "#8a8172", textTransform: "uppercase" }}>
          {t("loom")}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {JOB_KEYS.map((key) => (
            <span key={key} style={{ fontSize: 11, color: "#8a8172", whiteSpace: "nowrap" }}>
              <span
                style={{
                  display: "inline-block",
                  width: 9,
                  height: 9,
                  background: JOB_COLOUR[key],
                  marginRight: 4,
                  verticalAlign: "middle",
                }}
              />
              {t(`job_${key}` as never)}
            </span>
          ))}
        </div>
      </div>

      <Caption>{t("capLoom")}</Caption>

      <div style={{ position: "relative" }}>
        {byWorker.map(([workerId, entry]) => (
          <div key={workerId} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 1 }}>
            <button
              onClick={() => onSelectWorker(workerId)}
              style={{
                width: narrow ? 40 : 74,
                textAlign: "right",
                border: "none",
                background: "transparent",
                padding: 0,
                fontSize: 10,
                color: selectedWorker === workerId ? INK : "#8a8172",
                fontWeight: selectedWorker === workerId ? 700 : 400,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              {workerId.replace("north-", "N").replace("south-", "S")}
            </button>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
                height: 9,
                flex: "1 1 0",
                minWidth: 0,
                background: "#f2ece0",
              }}
            >
              {Array.from({ length: columns }, (unused, index) => {
                const cell = entry.cells.get(index + 1);
                const colour = cell ? (JOB_COLOUR[cell.job] ?? "#ded5c4") : "transparent";
                return (
                  <div
                    key={index}
                    onClick={() => {
                      onScrub(index + 1);
                      onSelectWorker(workerId);
                    }}
                    title={
                      cell
                        ? `${workerId} · ${lang === "zh" ? "第" : "turn "}${index + 1} · ${cell.job}${cell.did ? ` · ${cell.did}` : ""}`
                        : `${workerId} · ${index + 1}`
                    }
                    style={{
                      background: colour,
                      borderLeft: index + 1 === turn ? `1px solid ${INK}` : undefined,
                      cursor: "pointer",
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
