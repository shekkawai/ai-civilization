import { useEffect, useMemo, useState } from "react";
import { Backpack, StorageSlots, type Expectation } from "./Backpack";
import { CIV_COLOUR, type Selection, type View } from "./BeliefMap";
import { EngineText, type TurnDetail } from "./TurnSpine";
import { civLabel, useLang } from "./lang";
import { levelLabel, levelOf } from "./resource";
import { expectedRoute, onwardRoute, routeTurns } from "./route";
import { homeCentre } from "../lib/strategy";
import { RULES, SIGHT } from "../sim/config";
import type { BuildingFunction, CivId, Frame, Tile } from "../sim/types";
import { buildingFunctionNote, foreignWorkerObservation } from "./knowledge";

/**
 * What is happening at the thing you clicked.
 *
 * The previous inspector printed six chips — id, position, two carry numbers, a job word and a
 * destination. Every one of those is already visible on the map, so clicking told the reader
 * nothing they did not have. This one answers the question a click actually asks: *why is this
 * person standing here, and is it working?*
 *
 * Four layers, strictly separated, because merging them is how a spectator ends up believing a
 * model's account of itself:
 *
 *   1. 狀態      — engine fact about the thing right now.
 *   2. 現行指令  — the standing job, plus what is arithmetically derivable from it. `worker.job`
 *                  persists until the model replaces it, so this is a stored fact and not a guess.
 *   3. 本回合    — what the engine actually did with this worker this turn, from `action_results`,
 *                  which carries `workerIds` and so attributes exactly.
 *   4. 模型怎麼說 — the model's own words, in a visibly different register and never merged with
 *                  the three above.
 *
 * The honest limit from the design contract holds: there is no per-worker multi-turn plan in the
 * data. This may show the current order, where it came from and how long it has been held. It must
 * never stitch those into an itinerary the engine does not have.
 */

const RULE = "#ded5c4";
const INK = "#2b2723";
const MUTED = "#8a8172";
const CLAIM_BG = "#f7f3ea";
/** The page's own paper. A pinned heading has to be opaque or the record scrolls through it. */
const PAPER = "#faf6ee";

function distance(from: { x: number; z: number }, to: { x: number; z: number }) {
  return Math.round(Math.hypot(from.x - to.x, from.z - to.z));
}

const TERRAIN_LABEL: Record<string, { zh: string; en: string }> = {
  grass: { zh: "草地", en: "grass" },
  field: { zh: "糧田", en: "farmland" },
  oasis: { zh: "綠洲", en: "oasis" },
  stone: { zh: "石場", en: "quarry" },
  water: { zh: "水", en: "water" },
  ridge: { zh: "山脊", en: "ridge" },
};

/**
 * `config.ts` carries these in Traditional Chinese only, and v3 is bilingual. Kept here rather than
 * translated at the source: the engine writes Chinese into the database and every recorded season
 * already holds Chinese rows. Every number is read from `RULES`, never typed in.
 */
const FUNCTION_LABEL_TEXT: Record<BuildingFunction, { zh: string; en: string }> = {
  hall: { zh: "聚居地", en: "hall" },
  store: { zh: "倉庫", en: "store" },
  post: { zh: "哨站", en: "post" },
};

export interface WorkerTurn {
  turn: number;
  job: string;
  x: number;
  z: number;
  carryFood: number;
  carryStone: number;
}

/** A labelled block. Labels sit above values throughout v3, so nothing sizes itself to its text. */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, letterSpacing: "0.1em", color: MUTED, textTransform: "uppercase", marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.65 }}>{children}</div>
    </div>
  );
}

/**
 * Beside the map on a wide screen, under a map pinned to the top of the viewport on a phone.
 *
 * As a side panel it needs a frame — a bare block floating in the gutter reads as an accident —
 * but it is still a panel *in* the document, not over the map. Nothing on this page floats.
 *
 * The stacked variant used to render neither the title nor the clear control, on the assumption
 * that it was the last block on a page nobody would leave. It is not: it now sits directly under
 * the map, so it has to say what it is a record *of*, and it has to be closable — otherwise the
 * only way back to a full-height map is to select something else.
 */
function Shell({
  beside,
  title,
  stickyTop,
  onClear,
  children,
}: {
  beside?: boolean;
  title?: string;
  /**
   * Height of the pinned map block above, when there is one. The heading pins directly under it so
   * a reader four screens into a worker's record still knows whose record it is and can close it.
   */
  stickyTop?: number;
  onClear?: () => void;
  children: React.ReactNode;
}) {
  const { lang } = useLang();
  return (
    <div
      data-testid="v3-inspector"
      style={
        beside
          ? {
              border: `1px solid ${RULE}`,
              background: "#fdfbf6",
              padding: "12px 14px 4px",
              maxHeight: "calc(100vh - 32px)",
              overflowY: "auto",
            }
          : { borderTop: `1px solid ${RULE}`, paddingTop: 10, marginTop: 4, marginBottom: 10 }
      }
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
          borderBottom: `1px solid ${RULE}`,
          paddingBottom: 8,
          marginBottom: 12,
          ...(stickyTop === undefined
            ? null
            : { position: "sticky", top: stickyTop, zIndex: 2, background: PAPER, paddingTop: 6 }),
        }}
      >
        <div style={{ fontSize: 11, letterSpacing: "0.1em", color: MUTED, textTransform: "uppercase" }}>
          {title ?? (lang === "zh" ? "紀錄" : "record")}
        </div>
        {onClear ? (
          <button
            onClick={onClear}
            style={{
              border: "none",
              background: "transparent",
              color: MUTED,
              fontSize: beside ? 11 : 12,
              cursor: "pointer",
              // A phone tap target, not a desk one. 11px of bare text is a control a thumb misses,
              // which is the same reason the map's own buttons grow under `(pointer: coarse)`.
              padding: beside ? 0 : "4px 8px",
              margin: beside ? 0 : "-4px -8px",
              minHeight: beside ? undefined : 28,
            }}
          >
            {lang === "zh" ? "關閉" : "close"}
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** Everything the model wrote itself, kept in one visibly different register. */
function Claim({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: CLAIM_BG,
        borderLeft: `3px solid ${RULE}`,
        padding: "7px 10px",
        fontStyle: "italic",
        color: "#5f584e",
        fontSize: 12.5,
        lineHeight: 1.6,
        marginTop: 4,
      }}
    >
      <span style={{ fontStyle: "normal", fontSize: 10, letterSpacing: "0.08em", color: MUTED, textTransform: "uppercase" }}>
        {label}
      </span>
      <div>{children}</div>
    </div>
  );
}

export function Inspector({
  seasonId,
  frame,
  tiles,
  turn,
  selection,
  view,
  detail,
  protocolVersion,
  beside,
  stickyTop,
  onClear,
  onSelect,
}: {
  seasonId: string;
  frame: Frame;
  tiles: Tile[] | null;
  turn: number;
  selection?: Selection;
  view: View;
  detail: TurnDetail | null;
  protocolVersion: number;
  /** True when the panel sits in its own column beside the map. */
  beside?: boolean;
  /** Stacked under a pinned map: the height to pin this panel's own heading below. */
  stickyTop?: number;
  onClear?: () => void;
  onSelect?: (selection: Selection) => void;
}) {
  const { lang } = useLang();
  const [history, setHistory] = useState<WorkerTurn[]>([]);
  const workerId = selection?.kind === "worker" ? selection.id : undefined;

  useEffect(() => {
    if (!workerId) {
      setHistory([]);
      return;
    }
    let cancelled = false;
    fetch(
      `/api/research/worker?seasonId=${encodeURIComponent(seasonId)}&workerId=${encodeURIComponent(workerId)}`,
      { headers: { Accept: "application/json" } },
    )
      .then((response) => (response.ok ? response.json() : []))
      .then((payload) => {
        if (!cancelled) setHistory((payload as WorkerTurn[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [seasonId, workerId]);

  const civ = view === "truth" ? undefined : (view as CivId);

  if (!selection) {
    return (
      <Shell beside={beside} stickyTop={stickyTop}>
        <div style={{ fontSize: 13, color: MUTED }}>
          {lang === "zh"
            ? "點地圖上任何一格或任何一個人，這裡會說明那裡正在發生什麼。"
            : "Click any tile or person on the map and this explains what is happening there."}
        </div>
      </Shell>
    );
  }

  const worker = selection.id ? frame.workers.find((entry) => entry.id === selection.id) : undefined;
  if (worker) {
    return (
      <Shell
        beside={beside}
        stickyTop={stickyTop}
        onClear={onClear}
        title={lang === "zh" ? `人 · (${worker.x}, ${worker.z})` : `person · (${worker.x}, ${worker.z})`}
      >
        <WorkerCard
          worker={worker}
          civ={civ}
          frame={frame}
          tiles={tiles}
          turn={turn}
          history={history}
          detail={detail}
          protocolVersion={protocolVersion}
          onSelect={onSelect}
        />
      </Shell>
    );
  }

  return (
    <Shell
      beside={beside}
      stickyTop={stickyTop}
      onClear={onClear}
      title={lang === "zh" ? `地格 · (${selection.x}, ${selection.z})` : `tile · (${selection.x}, ${selection.z})`}
    >
      <TileCard
        selection={selection}
        civ={civ}
        frame={frame}
        tiles={tiles}
        turn={turn}
        protocolVersion={protocolVersion}
      />
    </Shell>
  );
}

function WorkerCard({
  worker,
  civ,
  frame,
  tiles,
  turn,
  history,
  detail,
  protocolVersion,
  onSelect,
}: {
  worker: Frame["workers"][number];
  civ?: CivId;
  frame: Frame;
  tiles: Tile[] | null;
  turn: number;
  history: WorkerTurn[];
  detail: TurnDetail | null;
  protocolVersion: number;
  onSelect?: (selection: Selection) => void;
}) {
  const { lang, t } = useLang();
  const zh = lang === "zh";
  const own = civ === undefined || worker.owner === civ;

  // Identity stays hidden, but the private report does reveal a currently visible stranger's
  // apparent job and exact load. Once they leave sight, none of their live state may leak through.
  if (!own) {
    const index = worker.z * RULES.width + worker.x;
    const visibleNow = civ ? frame.fog[civ]?.[index] === 2 : true;
    return (
      <>
        <Section label={zh ? "陌生人" : "a stranger"}>
          {foreignWorkerObservation(worker, visibleNow, lang)}
        </Section>
        <Section label={zh ? "觀察" : "observation"}>
          {visibleNow ? (zh ? `現在看見（第 ${turn} 回合）。` : `Visible now (turn ${turn}).`) : zh ? "目前看不到。" : "Not visible now."}
        </Section>
        {visibleNow ? (
          <>
            <Section label={zh ? "背包" : "backpack"}>
              <Backpack food={worker.carrying.food} stone={worker.carrying.stone} />
            </Section>
            <Section label={zh ? "距離" : "distance"}>
              {civ
                ? zh
                  ? `距離${civLabel(civ, lang)}的聚居地 ${distance(worker, homeCentre(frame, civ))} 格。`
                  : `${distance(worker, homeCentre(frame, civ))} tiles from ${civLabel(civ, lang)}'s hall.`
                : null}
            </Section>
          </>
        ) : null}
      </>
    );
  }

  const home = homeCentre(frame, worker.owner);
  const results = (detail?.results ?? []).filter((row) => row.workerIds?.includes(worker.id));

  // How long this worker has held the job it is holding, straight from `worker_turns`. The engine
  // keeps a job until it completes, fails or is replaced, so a long run is a fact about the model's
  // attention — and a long run of `idle` is the single most useful number on this panel.
  const upToNow = history.filter((row) => row.turn <= turn);
  const latest = upToNow[upToNow.length - 1];
  let held = 0;
  if (latest) {
    for (let index = upToNow.length - 1; index >= 0; index -= 1) {
      if (upToNow[index].job !== latest.job) break;
      held += 1;
    }
  }
  const idle = latest?.job === "idle";
  const reach = upToNow.reduce((furthest, row) => Math.max(furthest, distance(row, home)), 0);

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0 22px", marginBottom: 12 }}>
        <Section label={zh ? "身分" : "person"}>
          <span style={{ color: CIV_COLOUR[worker.owner], fontWeight: 600 }}>{worker.id}</span>
        </Section>
        <Section label={zh ? "位置" : "at"}>
          ({worker.x}, {worker.z}) · {zh ? `距家 ${distance(worker, home)} 格` : `${distance(worker, home)} tiles from home`}
        </Section>
        <Section label={zh ? "歷來最遠" : "furthest ever"}>
          {zh ? `${reach} 格` : `${reach} tiles`}
        </Section>
      </div>

      <SameTile worker={worker} civ={civ} frame={frame} onSelect={onSelect} />

      <NowAndNext
        worker={worker}
        frame={frame}
        tiles={tiles}
        lens={civ ?? "truth"}
        protocolVersion={protocolVersion}
      />

      <Section label={zh ? "背包" : "backpack"}>
        <Backpack
          food={worker.carrying.food}
          stone={worker.carrying.stone}
          expecting={expectation(worker, frame, tiles, zh, protocolVersion)}
        />
      </Section>

      <Section label={zh ? "現行指令" : "standing order"}>
        <JobLine worker={worker} frame={frame} tiles={tiles} turn={turn} />
        <div style={{ color: idle ? "#9c3c3c" : MUTED, marginTop: 2, fontWeight: idle ? 600 : 400 }}>
          {idle
            ? zh
              ? `已閒置 ${held} 回合。`
              : `Idle for ${held} turns.`
            : zh
              ? `這份工作已持續 ${held} 回合。`
              : `Has held this job for ${held} turns.`}
        </div>
      </Section>

      <Section label={t("whatHappened")}>
        {results.length === 0 ? (
          <span style={{ color: MUTED }}>
            {zh
              ? "本回合沒有針對這個人的新指示——他沿用之前收到的工作。"
              : "No new instruction named this person this turn; they continue the job they were already given."}
          </span>
        ) : (
          results.map((row) => {
            // Five statuses, three readings. `completed` is a success — reading anything that is
            // not `accepted` as a refusal printed 被拒 over the engine's own "gathered 5 food",
            // which is the one thing this section must never get wrong. `no-op` is neither: the
            // order was understood and changed nothing.
            const refused = row.status === "rejected" || row.status === "failed";
            const noop = row.status === "no-op";
            return (
            <div key={row.id} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <span
                style={{
                  color: refused ? "#9c3c3c" : noop ? MUTED : "#4a6b45",
                  fontSize: 11,
                  minWidth: 52,
                }}
              >
                {refused
                  ? zh
                    ? "被拒"
                    : "refused"
                  : noop
                    ? zh
                      ? "無變化"
                      : "no change"
                    : zh
                      ? "已執行"
                      : "done"}
              </span>
              <span>
                <span style={{ color: MUTED, marginRight: 6 }}>{row.actionType}</span>
                <EngineText text={row.text} />
              </span>
            </div>
            );
          })
        )}
      </Section>

      <Claim label={t("modelSays")}>
        {frame.journal[worker.owner]?.trim() ||
          (zh ? "這回合沒有留下日誌。" : "No journal entry this turn.")}
      </Claim>
    </>
  );
}

/**
 * The other people standing on this tile. The map draws one marker with `×N` on it, so without
 * this list a click on a crowd of four could only ever open one of them, and the other three would
 * be unreachable — which is how ten people reading as one became a bug worth a regression test.
 *
 * The roster runs through the same lens filter as the map, so it can never name somebody the
 * selected civilization cannot see. Through a civilization's eyes a stranger stays a stranger.
 */
function SameTile({
  worker,
  civ,
  frame,
  onSelect,
}: {
  worker: Frame["workers"][number];
  civ?: CivId;
  frame: Frame;
  onSelect?: (selection: Selection) => void;
}) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const others = frame.workers.filter((entry) => {
    if (entry.id === worker.id) return false;
    if (entry.x !== worker.x || entry.z !== worker.z) return false;
    if (!civ) return true;
    return entry.owner === civ || frame.fog[civ]?.[entry.z * RULES.width + entry.x] === 2;
  });
  if (others.length === 0) return null;

  return (
    <Section label={zh ? `同一格上還有 ${others.length} 人` : `${others.length} more on this tile`}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {others.map((entry) => {
          const known = !civ || entry.owner === civ;
          return (
            <button
              key={entry.id}
              onClick={
                onSelect
                  ? () => onSelect({ kind: "worker", id: entry.id, x: entry.x, z: entry.z })
                  : undefined
              }
              disabled={!onSelect}
              style={{
                border: `1px solid ${RULE}`,
                background: "transparent",
                color: known ? CIV_COLOUR[entry.owner] : MUTED,
                fontSize: 12,
                padding: "1px 7px",
                cursor: onSelect ? "pointer" : "default",
              }}
            >
              {known ? entry.id : zh ? "陌生人" : "a stranger"}
            </button>
          );
        })}
      </div>
    </Section>
  );
}

/**
 * Two sentences: what this person is physically doing at this instant, and what the rules say
 * happens when that finishes.
 *
 * `frame.destination` already carries the *leg* rather than the job — a gatherer whose pack is full
 * is given the storehouse, not the quarry — so "now" is a stored fact, and the walk is measured
 * along the route rather than as the crow flies. "Next" is the engine's own transition out of the
 * current leg in `goalsFor`, which is a rule and not a plan: there is no per-worker itinerary in
 * this data, and this must never pretend otherwise.
 *
 * The route follows the lens. Through a civilization's eyes it is searched over what that
 * civilization has seen, so it is that civilization's expectation; on truth it is where the worker
 * will really walk. When they disagree, the disagreement is the point.
 */
function NowAndNext({
  worker,
  frame,
  tiles,
  lens,
  protocolVersion,
}: {
  worker: Frame["workers"][number];
  frame: Frame;
  tiles: Tile[] | null;
  lens: CivId | "truth";
  protocolVersion: number;
}) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const job = worker.job;
  const target = worker.destination;

  const route = useMemo(
    () => (tiles ? expectedRoute(tiles, frame, worker, lens) : []),
    [tiles, frame, worker, lens],
  );
  // The return leg, so the panel can quote the round trip rather than half of it. A carry job's
  // cost is the loop, not the outbound walk — that is the whole reason a distant source is worth
  // less than a near one, and it is the reading this panel was missing.
  const onward = useMemo(
    () => (tiles && route.length > 0 ? onwardRoute(tiles, frame, worker, lens, route[route.length - 1]) : []),
    [tiles, frame, worker, lens, route],
  );
  const steps = Math.max(0, route.length - 1);
  const loopTurns = onward.length > 1 ? routeTurns(route) + routeTurns(onward) : 0;
  const arrived = !target || (worker.x === target.x && worker.z === target.z) || steps === 0;

  const now = (() => {
    if (job.kind === "idle") return zh ? "站著等候新指令。" : "Standing still, waiting for an instruction.";
    if (!target) return zh ? "沒有目的地。" : "No destination.";
    if (arrived) {
      if (job.kind === "gather") return zh ? `在 (${target.x}, ${target.z}) 採集中。` : `Gathering at (${target.x}, ${target.z}).`;
      if (job.kind === "build") return zh ? "在工地上施工。" : "Working on the site.";
      if (job.kind === "repair") return zh ? "在結構上修補。" : "Repairing the structure.";
      if (job.kind === "remove") return zh ? "在拆解結構。" : "Taking the structure apart.";
      if (job.kind === "deposit") return zh ? "在存放處卸貨。" : "Unloading at storage.";
      return zh ? "已到達目的地。" : "At the destination.";
    }
    const turns = routeTurns(route);
    return zh
      ? `正走向 (${target.x}, ${target.z})，還有 ${steps} 步，每回合最多 ${RULES.workerMove} 步，約 ${turns} 回合。`
      : `Walking to (${target.x}, ${target.z}) — ${steps} steps left at ${RULES.workerMove} a turn, about ${turns} turns.`;
  })();

  const next = (() => {
    if (job.kind === "idle") return zh ? "在模型下達新指令之前，什麼都不會發生。" : "Nothing happens until the model gives a new instruction.";
    if (job.kind === "move") return zh ? "到達之後這份工作結束，他會變回待命。" : "On arrival this job ends and they go idle.";
    if (job.kind === "gather") {
      if (protocolVersion >= 18) {
        return zh
          ? "背包裝滿便自動回倉。該格採空時，模型可在下一次決策改派到另一個已觀察的糧食或石材格，繼續裝同一個混合背包；若沒有新指令，原工作便開始回倉。"
          : "A full backpack returns automatically. When this tile runs out, the model may assign another observed food or stone cell on its next decision and keep filling the same mixed backpack; without a new instruction, the standing job starts home.";
      }
      return zh
        ? "背包裝滿或該格採空便自動回倉；背包已有一種物資時，改派採另一種亦會先回倉。卸貨後再走回目前的採集點。"
        : "A full backpack or an empty tile sends them home; assigning a different resource kind while the pack already holds goods also makes them unload first. After unloading they return to the current source.";
    }
    if (job.kind === "deposit") return zh ? "卸完貨這份工作就結束，他會變回待命。" : "Once the pack is empty this job ends and they go idle.";
    if (job.kind === "build")
      return zh
        ? "缺石就先回存放處取石，再運到工地放置；整座建成後變回待命。"
        : "Short of stone they fetch it from storage first, carry it to the site and place it; when the structure is finished they go idle.";
    if (job.kind === "repair") return zh ? "修補到沒有缺口為止。" : "They keep repairing until nothing is missing.";
    return zh
      ? "拆到背包滿就運回存放處，再回來繼續；整座拆光後變回待命。"
      : "When the pack fills they haul it to storage and come back; once nothing is standing they go idle.";
  })();

  return (
    <>
      <Section label={zh ? "現在" : "right now"}>
        {now}
        {steps > 0 ? (
          <div style={{ color: MUTED, marginTop: 2, fontSize: 12 }}>
            {lens === "truth"
              ? zh
                ? "地圖上的實線是實際會走的路。"
                : "The solid line on the map is the route they will actually walk."
              : zh
                ? "地圖上的實線是按他們見過的地形算出來的路——未見過的地方當作可以通行。"
                : "The solid line is the route as they expect it, searched over ground they have seen; never-seen ground is assumed open."}
          </div>
        ) : null}
        {loopTurns > 0 ? (
          <div style={{ color: MUTED, marginTop: 2, fontSize: 12 }}>
            {zh
              ? `連虛線那段回程一起算，這一趟來回約 ${loopTurns} 回合。`
              : `Counting the dashed return leg, this round trip is about ${loopTurns} turns.`}
          </div>
        ) : null}
      </Section>
      <Section label={zh ? "接下來" : "what happens next"}>
        <span style={{ color: MUTED }}>{next}</span>
      </Section>
    </>
  );
}

/**
 * How much the standing job is expected to add to the pack before it stops. Capped by free space
 * first, then by the source — a quarry with 6 left cannot fill 25 slots.
 *
 * The source figure is only consulted when the lens can see that tile. Reading a true node amount
 * through a civilization's eyes would be a leak, and it would be a leak of exactly the number that
 * decides whether their plan works.
 */
function expectation(
  worker: Frame["workers"][number],
  frame: Frame,
  tiles: Tile[] | null,
  zh: boolean,
  protocolVersion: number,
): Expectation | undefined {
  const job = worker.job;
  const free = RULES.carry - (worker.carrying.food + worker.carrying.stone);
  if (free <= 0) return undefined;

  if (job.kind === "gather") {
    const tile = tiles?.[job.at.z * RULES.width + job.at.x];
    const kind = tile?.node?.kind ?? "food";
    if (
      protocolVersion < 18 &&
      worker.carrying.food + worker.carrying.stone > 0 &&
      worker.carrying[kind] === 0
    ) {
      return undefined;
    }
    const node = frame.nodes.find((entry) => entry.x === job.at.x && entry.z === job.at.z);
    const left = node?.amount;
    if (left !== undefined && left < free)
      return { kind, amount: left, note: zh ? `該格只剩 ${left}` : `the tile holds ${left}` };
    return { kind, amount: free };
  }

  if (job.kind === "remove") {
    const building = frame.buildings.find((entry) => entry.id === job.buildingId);
    if (!building) return undefined;
    const standing = building.blocks.filter(Boolean).length;
    const recoverable = standing * RULES.salvage;
    return {
      kind: "stone",
      amount: Math.min(free, recoverable),
      note: zh ? `尚餘 ${standing} 格 × ${RULES.salvage} 石` : `${standing} cells left × ${RULES.salvage} stone`,
    };
  }

  if (job.kind === "build" || job.kind === "repair") {
    const building = frame.buildings.find((entry) => entry.id === job.buildingId);
    if (!building) return undefined;
    const missing =
      job.kind === "repair" ? building.removed : Math.max(0, building.total - building.placed);
    if (missing <= 0) return undefined;
    return {
      kind: "stone",
      amount: Math.min(free, missing * RULES.blockCost),
      note: zh ? `還欠 ${missing} 格` : `${missing} cells still needed`,
    };
  }

  return undefined;
}

/**
 * The standing job with everything the rules make derivable from it, and nothing else. For a walk,
 * how far is left and how many turns that is at the fixed move rate. For a gather, what is actually
 * left in that tile — the number that tells a reader a party is mining an exhausted quarry. For a
 * worksite, blocks placed against blocks needed and the stone still owed, beside what the
 * settlement actually holds.
 */
function JobLine({
  worker,
  frame,
  tiles,
  turn,
}: {
  worker: Frame["workers"][number];
  frame: Frame;
  tiles: Tile[] | null;
  turn: number;
}) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const job = worker.job;

  if (job.kind === "idle") return <span>{zh ? "沒有工作。" : "No job."}</span>;

  if (job.kind === "move") {
    const away = distance(worker, job.to);
    const turns = Math.ceil(away / RULES.workerMove);
    return (
      <span>
        {zh
          ? `前往 (${job.to.x}, ${job.to.z})。還差 ${away} 格，每回合最多走 ${RULES.workerMove} 格，約 ${turns} 回合。`
          : `Walking to (${job.to.x}, ${job.to.z}). ${away} tiles left at ${RULES.workerMove} tiles a turn — about ${turns} turns.`}
      </span>
    );
  }

  if (job.kind === "gather") {
    const node = frame.nodes.find((entry) => entry.x === job.at.x && entry.z === job.at.z);
    const tile = tiles?.[job.at.z * RULES.width + job.at.x];
    const away = distance(worker, job.at);
    const rate = tile?.node?.kind === "stone" ? RULES.gatherStone : RULES.gatherFood;
    const free = RULES.carry - (worker.carrying.food + worker.carrying.stone);
    return (
      <span>
        {zh
          ? `在 (${job.at.x}, ${job.at.z}) 採集，每回合 ${rate}。`
          : `Gathering at (${job.at.x}, ${job.at.z}), ${rate} a turn.`}{" "}
        {away > 0
          ? zh
            ? `還要走 ${away} 格。`
            : `${away} tiles still to walk.`
          : null}{" "}
        {node
          ? zh
            ? `該格尚餘 ${node.amount}。`
            : `${node.amount} left in that tile.`
          : zh
            ? "該格已經沒有東西可採。"
            : "Nothing left in that tile."}{" "}
        {zh ? `背包還可裝 ${free}，滿了就自動回程。` : `${free} space left; a full backpack returns automatically.`}
      </span>
    );
  }

  if (job.kind === "deposit") {
    return <span>{zh ? "正把背包送回存放處。" : "Carrying the backpack back to storage."}</span>;
  }

  const building = frame.buildings.find((entry) => entry.id === job.buildingId);
  if (!building) return <span>{job.kind}</span>;
  const foreign = building.owner !== worker.owner;
  const remaining = Math.max(0, building.total - building.placed);
  const owed = remaining * RULES.blockCost;

  if (job.kind === "build") {
    return (
      <span>
        {zh
          ? `在工地施工：已放 ${building.placed} / ${building.total} 格`
          : `Building: ${building.placed} / ${building.total} cells placed`}
        {remaining > 0
          ? zh
            ? `，還欠 ${owed} 石（${remaining} 格 × ${RULES.blockCost}）。目前存石 ${frame.civs[worker.owner].stone}。`
            : `, ${owed} stone still owed (${remaining} × ${RULES.blockCost}). The settlement holds ${frame.civs[worker.owner].stone}.`
          : zh
            ? "，材料已足。"
            : ", materials are covered."}
      </span>
    );
  }

  if (job.kind === "repair") {
    return (
      <span>
        {zh
          ? `修補 ${foreign ? "一座結構" : building.name}，每回合 ${RULES.repairRate} 格。`
          : `Repairing ${foreign ? "a structure" : building.name} at ${RULES.repairRate} cells a turn.`}
      </span>
    );
  }

  const rate = foreign ? RULES.removeForeign : RULES.removeOwn;
  const ready = job.adjacentSince !== undefined && turn - job.adjacentSince >= RULES.prepareTurns;
  return (
    <span>
      {zh
        ? `拆解${foreign ? "對方的結構" : `自己的 ${building.name}`}，每回合 ${rate} 格，每格取回 ${RULES.salvage} 石。`
        : `Taking apart ${foreign ? "the other side's structure" : `its own ${building.name}`} at ${rate} cells a turn, recovering ${RULES.salvage} stone each.`}{" "}
      {ready
        ? zh
          ? "已就位。"
          : "In position."
        : zh
          ? "剛到，本回合還不能動手。"
          : "Just arrived; cannot start this turn."}
    </span>
  );
}

function TileCard({
  selection,
  civ,
  frame,
  tiles,
  turn,
  protocolVersion,
}: {
  selection: Selection;
  civ?: CivId;
  frame: Frame;
  tiles: Tile[] | null;
  turn: number;
  protocolVersion: number;
}) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const index = selection.z * RULES.width + selection.x;
  const knowledge = civ ? (frame.fog[civ]?.[index] ?? 0) : 2;
  const seen = civ ? frame.lastSeen[civ]?.[index] : undefined;

  if (civ && knowledge === 0) {
    return (
      <>
        <Section label={zh ? "未見之地" : "never seen"}>
          {zh
            ? `(${selection.x}, ${selection.z}) 從未被${civLabel(civ, lang)}看見。他們不知道那裡是草地、水、石場，還是別人的城。`
            : `(${selection.x}, ${selection.z}) has never been seen by ${civLabel(civ, lang)}. They do not know whether it is grass, water, a quarry or somebody's town.`}
        </Section>
        <Section label={zh ? "距離" : "distance"}>
          {zh
            ? `距離他們的聚居地 ${distance(selection, homeCentre(frame, civ))} 格。`
            : `${distance(selection, homeCentre(frame, civ))} tiles from their hall.`}
        </Section>
      </>
    );
  }

  const tile = tiles?.[index];
  const terrain = TERRAIN_LABEL[tile?.terrain ?? "grass"];
  // Kept apart on purpose: an observed reading carries the turn it was taken and may be stale, and
  // the truth reading never is. Merging them would let a memory print as a current fact.
  const observedNode = civ
    ? frame.observedNodes[civ].find((entry) => entry.x === selection.x && entry.z === selection.z)
    : undefined;
  const node =
    observedNode ?? (civ ? undefined : frame.nodes.find((entry) => entry.x === selection.x && entry.z === selection.z));
  // A placed block claims its cell outright; an incomplete building also claims its whole
  // footprint, so clicking a bare construction-site cell explains the worksite instead of
  // printing empty ground. The owner guard below still keeps foreign structures unnamed.
  const building = frame.buildings.find((entry) =>
    entry.cells.some(
      (cell, cellIndex) =>
        cell.x === selection.x && cell.z === selection.z && (entry.blocks[cellIndex] > 0 || !entry.complete),
    ),
  );
  const observedBuilding = civ
    ? frame.observedBuildings[civ].find((entry) =>
        entry.cells.some((cell) => cell.x === selection.x && cell.z === selection.z),
      )
    : undefined;
  const piles = (civ ? frame.observedPiles[civ] : frame.piles).filter(
    (pile) => pile.x === selection.x && pile.z === selection.z,
  );
  const standing = frame.workers.filter(
    (entry) =>
      entry.x === selection.x &&
      entry.z === selection.z &&
      (civ === undefined || entry.owner === civ || knowledge === 2),
  );
  const headingHere = frame.workers.filter(
    (entry) =>
      (civ === undefined || entry.owner === civ) &&
      entry.destination &&
      entry.destination.x === selection.x &&
      entry.destination.z === selection.z,
  );

  const observation =
    civ === undefined
      ? zh
        ? `事實視角 · 第 ${turn} 回合實況`
        : `Truth view · current at turn ${turn}`
      : knowledge === 2
        ? zh
          ? `目前看見 · 第 ${turn} 回合實況`
          : `Visible now · current at turn ${turn}`
        : zh
          ? `過去記憶 · 最後看見第 ${seen} 回合 · 已過 ${Math.max(0, turn - (seen ?? turn))} 回合`
          : `Memory · last seen turn ${seen} · ${Math.max(0, turn - (seen ?? turn))} turns ago`;

  return (
    <>
      <div
        style={{
          display: "inline-block",
          marginBottom: 12,
          borderLeft: `3px solid ${knowledge === 2 ? INK : "#a59b89"}`,
          background: knowledge === 2 ? "#f0ebdf" : CLAIM_BG,
          padding: "6px 10px",
          color: knowledge === 2 ? INK : "#6f675d",
          fontWeight: 600,
          fontSize: 12.5,
        }}
      >
        {observation}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0 22px" }}>
        <Section label={zh ? "地格" : "tile"}>
          ({selection.x}, {selection.z}) · {zh ? terrain.zh : terrain.en}
        </Section>
        <Section label={zh ? "距離聚居地" : "from the halls"}>
          {civ
            ? zh
              ? `${distance(selection, homeCentre(frame, civ))} 格`
              : `${distance(selection, homeCentre(frame, civ))} tiles`
            : zh
              ? `北岸 ${distance(selection, homeCentre(frame, "north"))} 格 · 南原 ${distance(selection, homeCentre(frame, "south"))} 格`
              : `north ${distance(selection, homeCentre(frame, "north"))} · south ${distance(selection, homeCentre(frame, "south"))} tiles`}
        </Section>
      </div>

      {tile?.node ? (
        <Section label={zh ? "資源" : "resource"}>
          {/* The same four steps the map draws, named. A reader who sees a dashed husk on the map
              should find the word for it here rather than having to infer it from `0 / 120`. */}
          {zh
            ? `${tile.node.kind === "stone" ? "石材" : tile.terrain === "oasis" ? "綠洲共享糧池" : "糧食"} ${node?.amount ?? 0} / ${tile.node.cap}（${levelLabel(levelOf(node?.amount ?? 0, tile.node.cap), true)}）`
            : `${tile.node.kind === "stone" ? "Stone" : tile.terrain === "oasis" ? "Shared Oasis food" : "Food"} ${node?.amount ?? 0} / ${tile.node.cap} — ${levelLabel(levelOf(node?.amount ?? 0, tile.node.cap), false)}`}
          {" · "}
          {/* No 🔒 on either branch. It used to carry one, and that stopped being true in v22:
              the private report prints every cell the civilization has actually looked at as
              `f120/120+3@26` — amount, cap and its own regrowth rate. What stays hidden is ground
              they have never seen, not the rules of ground they are standing on. */}
          {tile.terrain === "oasis"
            ? zh
              ? `四格共用同一糧池；每回合 +${tile.node.regen}，上限 ${tile.node.cap}，綠洲不能建造`
              : `all four cells share this pool; +${tile.node.regen} a turn, capped at ${tile.node.cap}; Oasis ground is unbuildable`
            : tile.node.regen > 0
            ? zh
              ? `每回合 +${tile.node.regen}，上限 ${tile.node.cap}；被方塊壓住則停止`
              : `+${tile.node.regen} a turn, capped at ${tile.node.cap}; stops if a block covers it`
            : zh
              ? "完全不會再生——採完就永遠沒有了"
              : "never regrows — once worked out it is gone for good"}
          {observedNode && knowledge === 1 ? (
            <div style={{ color: MUTED }}>
              {zh
                ? `這是第 ${observedNode.turn} 回合的記憶，可能已經不準。`
                : `That reading is a memory from turn ${observedNode.turn} and may be out of date.`}
            </div>
          ) : null}
        </Section>
      ) : null}

      {building && (civ === undefined || building.owner === civ) ? (
        <StructureCard building={building} protocolVersion={protocolVersion} />
      ) : null}

      {/* A foreign structure never reveals its function, its name or its true size — only the cells
          this observer has actually laid eyes on. */}
      {observedBuilding && observedBuilding.owner !== civ ? (
        <Section label={zh ? "對方的結構" : "the other side's structure"}>
          {zh
            ? `用途不明。見過 ${observedBuilding.visibleCells + observedBuilding.rememberedCells} 格，其中 ${observedBuilding.visibleCells} 格現在看得見；最早第 ${observedBuilding.oldestObservationTurn} 回合，最近第 ${observedBuilding.newestObservationTurn} 回合。整體有多大並不知道。`
            : `Purpose unknown. ${observedBuilding.visibleCells + observedBuilding.rememberedCells} cells seen, ${observedBuilding.visibleCells} of them visible now; first on turn ${observedBuilding.oldestObservationTurn}, most recently on turn ${observedBuilding.newestObservationTurn}. How large it is in total is not known.`}
        </Section>
      ) : null}

      {piles.length > 0 ? (
        <Section label={zh ? "地上物資" : "loose goods"}>
          {piles.map((pile) => (
            <div key={pile.id}>
              {zh
                ? `糧 ${pile.stock.food} · 石 ${pile.stock.stone}（第 ${pile.turn} 回合掉在這裡，任何人走過都可以撿起）`
                : `${pile.stock.food} food · ${pile.stock.stone} stone, dropped on turn ${pile.turn}; anyone who walks over it may pick it up`}
            </div>
          ))}
        </Section>
      ) : null}

      {standing.length > 0 ? (
        <Section label={zh ? "站在這裡的人" : "people here"}>
          {standing.map((entry) => (
            <div key={entry.id} style={{ color: CIV_COLOUR[entry.owner] }}>
              {civ === undefined || entry.owner === civ
                ? `${entry.id} — ${entry.job.kind}`
                : foreignWorkerObservation(entry, true, lang)}
            </div>
          ))}
        </Section>
      ) : null}

      {headingHere.length > 0 ? (
        <Section label={zh ? "正往這裡來" : "on their way here"}>
          {headingHere.map((entry) => entry.id).join("、")}
        </Section>
      ) : null}

      {civ === undefined ? (
        <Section label={zh ? "誰見過這裡 🔒" : "who has seen this 🔒"}>
          {(["north", "south"] as CivId[]).map((side) => {
            const level = frame.fog[side]?.[index] ?? 0;
            const at = frame.lastSeen[side]?.[index];
            return (
              <div key={side} style={{ color: CIV_COLOUR[side] }}>
                {civLabel(side, lang)}:{" "}
                {level === 0
                  ? zh
                    ? "從未見過"
                    : "never seen"
                  : level === 2
                    ? zh
                      ? "現在看得見"
                      : "visible now"
                    : zh
                      ? `第 ${at} 回合見過，已過 ${Math.max(0, turn - (at ?? turn))} 回合`
                      : `seen on turn ${at}, ${Math.max(0, turn - (at ?? turn))} turns ago`}
              </div>
            );
          })}
        </Section>
      ) : null}
    </>
  );
}

/**
 * An owned structure, at the depth the earlier design gave it: what it is, how much of it is
 * actually standing, what it still owes, what it holds and what it contributes.
 *
 * Standing blocks and `placed` are different numbers and both matter. `placed` counts cells ever
 * laid; `standing` counts cells still there. A structure that reads `20 / 20 placed` while eight
 * blocks are missing has been taken apart, and printing only the first would hide that entirely —
 * which is the single event this whole simulation exists to catch.
 */
function StructureCard({
  building,
  protocolVersion,
}: {
  building: Frame["buildings"][number];
  protocolVersion: number;
}) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const standing = building.blocks.reduce((sum, present) => sum + (present > 0 ? 1 : 0), 0);
  const remaining = Math.max(0, building.total - building.placed);
  const activeStorage =
    building.complete &&
    (building.fn === "hall" || building.fn === "store") &&
    building.storageCapacity !== undefined &&
    building.storageCapacity > 0;

  return (
    <>
    <Section label={zh ? "結構" : "structure"}>
      <div>
        <span style={{ color: CIV_COLOUR[building.owner], fontWeight: 600 }}>{building.name}</span>
        <span style={{ color: MUTED }}>
          {" · "}
          {FUNCTION_LABEL_TEXT[building.fn]?.[zh ? "zh" : "en"] ?? building.fn}
          {" · "}
          {building.cells.length}
          {zh ? " 格佔地" : " cells"}
        </span>
      </div>

      <div>
        {building.complete
          ? zh
            ? `已完成，${standing} / ${building.total} 格仍然立著`
            : `Complete — ${standing} of ${building.total} cells still standing`
          : zh
            ? `仍是工地：已放 ${building.placed} / ${building.total} 格`
            : `Still a worksite: ${building.placed} / ${building.total} cells placed`}
        {building.removed > 0 ? (
          <span style={{ color: "#9c3c3c" }}>
            {zh
              ? `，已被拆走 ${building.removed} 格`
              : `, ${building.removed} cells taken apart`}
          </span>
        ) : null}
        {zh ? "。" : "."}
      </div>

      {remaining > 0 ? (
        <div style={{ color: MUTED }}>
          {zh
            ? `還差 ${remaining} 格，需要 ${remaining * RULES.blockCost} 石（每格 ${RULES.blockCost}）。`
            : `${remaining} cells to go, needing ${remaining * RULES.blockCost} stone (${RULES.blockCost} each).`}
        </div>
      ) : null}

      {building.workerPlaces ? (
        <div>
          {protocolVersion >= 15
            ? zh
              ? `整個文明現時可容納 ${building.workerPlaces} 人：自家所有已完成建築仍然站立的方塊總數 ÷ 3，再向下取整。`
              : `Settlement-wide capacity is ${building.workerPlaces} people: floor(all standing blocks in completed owned structures ÷ 3).`
            : zh
              ? `提供 ${building.workerPlaces} 個人口位置。`
              : `Supplies ${building.workerPlaces} worker places.`}
        </div>
      ) : null}

      {!building.complete && building.fn === "store" ? (
        <div style={{ color: MUTED }}>
          {zh
            ? "倉存尚未啟用；工地完成前容量是 0。"
            : "Storage is inactive; capacity stays at 0 until the worksite is complete."}
        </div>
      ) : null}

      <div style={{ color: MUTED }}>
        {zh
          ? `視野 ${SIGHT[building.fn]} 格；拆一格取回 ${RULES.salvage} 石（拆別人的每回合 ${RULES.removeForeign} 格，拆自己的 ${RULES.removeOwn} 格）。`
          : `Sees ${SIGHT[building.fn]} tiles; removing a cell recovers ${RULES.salvage} stone (${RULES.removeForeign} cell a turn on someone else's, ${RULES.removeOwn} on your own).`}
      </div>
      <div style={{ color: MUTED }}>
        {buildingFunctionNote(building.fn, protocolVersion, lang)}
      </div>
    </Section>
    {activeStorage ? (
      <Section label={zh ? "這座倉存" : "this storage structure"}>
        <StorageSlots
          food={building.stock.food}
          stone={building.stock.stone}
          capacity={building.storageCapacity!}
        />
        <div style={{ color: MUTED, marginTop: 4 }}>
          {zh
            ? "這只是這一座建築的存量與空位，不是整個文明隔空共用的倉庫。工人必須親身走到這裡旁邊才能卸貨。"
            : "These are this structure's own goods and empty spaces, not one remote inventory shared across the civilization. A worker must physically reach this building to unload here."}
        </div>
      </Section>
    ) : null}
    </>
  );
}
