import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BeliefMap, CIV_COLOUR, type Selection, type View } from "./BeliefMap";
import { Ceilings } from "./Ceilings";
import { Charts, type SeriesPoint } from "./Charts";
import { Correspondence } from "./Correspondence";
import { Notebooks } from "./Notebooks";
import { Effort } from "./Effort";
import { Efficiency } from "./Efficiency";
import { Vitals } from "./Vitals";
import { Legend } from "./Legend";
import { Loom } from "./Loom";
import { Logistics } from "./Logistics";
import { ResourceBars } from "./ResourceBars";
import { Caption, Note, RulePanel, TeachProvider, useTeach } from "./RuleNote";
import { SinceLastVisit } from "./SinceLastVisit";
import { Summary } from "./Summary";
import { TurnSpine, type TurnDetail } from "./TurnSpine";
import { Inspector } from "./Inspector";
import { Pressure } from "./Pressure";
import { TrendNotes } from "./TrendNotes";
import { Rules } from "./Rules";
import { api, type Landmark, type ReplayFrame, type SeasonEntry, type SeasonStatus } from "./api";
import { believesLabel, civLabel, useLang, V3LangProvider } from "./lang";
import type { RuleKey } from "./rules";
import { translateEventText } from "../lib/game-events";
import { RULES } from "../sim/config";
import type { CivId, Tile } from "../sim/types";

/**
 * The v3 spectator page. There is no live mode and no replay mode — there is a playhead. On the
 * newest turn you are live; drag it back and you are in replay, with the same components. A turn
 * arriving while you read never moves the view; it offers.
 *
 * See DESIGN-v3.md for the contract this implements.
 */

const PAPER = "#faf6ee";
const INK = "#2b2723";
const RULE = "#ded5c4";

/**
 * `?season=<id>` has always replayed an archived season, but nothing on the page said so, so in
 * practice only someone who had read the source could reach one. The picker below is the whole
 * fix: the list is the same one the API already returns, newest first, and choosing an entry
 * writes the parameter and reloads rather than swapping state — every panel here keys its fetches
 * on `seasonId`, and a reload is a shorter, more honest path than trusting all of them to reset.
 */
function useSeasonParam() {
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [seasons, setSeasons] = useState<SeasonEntry[]>([]);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("season");
    api.seasons().then((list) => {
      setSeasons(list ?? []);
      setSeasonId(requested ?? list?.[0]?.id ?? null);
    });
  }, []);
  return { seasonId, seasons };
}

function SeasonPicker({ seasonId, seasons }: { seasonId: string; seasons: SeasonEntry[] }) {
  const known = seasons.some((season) => season.id === seasonId);
  return (
    <select
      value={seasonId}
      onChange={(event) => {
        const next = new URL(window.location.href);
        next.searchParams.set("season", event.target.value);
        window.location.href = next.toString();
      }}
      style={{
        color: "#8a8172",
        background: "transparent",
        border: `1px solid ${RULE}`,
        borderRadius: 4,
        padding: "1px 4px",
        font: "inherit",
        maxWidth: "min(60vw, 340px)",
      }}
    >
      {!known && <option value={seasonId}>{seasonId}</option>}
      {seasons.map((season) => (
        <option key={season.id} value={season.id}>
          {season.id} · {season.status} · {season.turns}
        </option>
      ))}
    </select>
  );
}

function useWindowSize() {
  const [size, setSize] = useState(() =>
    typeof window === "undefined"
      ? { width: 1200, height: 800 }
      : { width: window.innerWidth, height: window.innerHeight },
  );
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

const STACK_BREAKPOINT = 900;

/** Below this, every row of figures folds to one line each and the map takes the whole width. */
const NARROW_BREAKPOINT = 640;

/** The inspector's own column, beside the map on a wide screen. */
const INSPECTOR_WIDTH = 380;
const MAP_GUTTER = 28;

/**
 * One map gets the available width without becoming too large to read as an overview — and, above
 * the stacking breakpoint, without taking the inspector's column with it.
 *
 * The inspector sits beside the map rather than under it (Shek's call, 2026-08-07). Clicking a tile
 * and then having to look away from the map to read about it breaks the loop the map exists for:
 * you compare the record against the thing you clicked, and on a tall page the two were never on
 * screen together.
 */
function singleMapSize(width: number) {
  const beside = width >= STACK_BREAKPOINT;
  const available = Math.min(width, 1180) - 32 - (beside ? INSPECTOR_WIDTH + MAP_GUTTER : 0);
  return Math.max(220, Math.min(640, Math.floor(available)));
}

/**
 * The map is a viewport onto the world, not a picture of it, so its height is set by the screen
 * rather than by the world being square (Shek's call, 2026-08-07: "the map should [fit] the screen
 * viewport"). The reserve covers the header, the lens switch and the map's own caption row — enough
 * that the whole stage lands above the fold on a laptop instead of one scroll below it.
 */
function mapStageHeight(windowHeight: number, mapWidth: number, narrow = false) {
  // A phone is tall and narrow, so tying the map's height to its width throws away the one
  // dimension a phone has. The reserve is smaller too because the compact header above it is.
  if (narrow) return Math.max(300, Math.min(560, windowHeight - 210));
  return Math.max(300, Math.min(mapWidth, windowHeight - 250));
}

/**
 * A stacked screen with something selected is a split screen, not a longer page (Shek's call,
 * 2026-08-09: reading the record meant scrolling the map off the screen and back).
 *
 * The desktop fix was to put the inspector in its own column beside the map, for exactly one
 * reason: *reading a record about a tile you can no longer see is not inspection*. Below 900px
 * there is no second column to give it, so the map gives up height instead — it drops to this
 * fraction of the viewport and pins itself to the top while the record scrolls underneath. The map
 * stays a map, the record is read by ordinary page scrolling, and nothing floats over anything.
 *
 * Shrinking the map is safe with the camera: `BeliefMap` re-clamps a reader-aimed camera on a box
 * change and its selection effect pans a target that the shorter viewport has pushed out of sight.
 */
function inspectMapHeight(windowHeight: number, full: number) {
  return Math.max(220, Math.min(full, Math.round(windowHeight * 0.42)));
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "#8a8172", textTransform: "uppercase" }}>
      {children}
    </div>
  );
}

/**
 * Labels sit above numbers, never beside them — the layout must not size itself to its text.
 *
 * A figure that carries a `rule` becomes clickable: the explanation opens in one panel docked below
 * the whole row, so clicking a second figure replaces the panel rather than pushing the page about.
 */
function Stat({
  label,
  value,
  hint,
  rule,
  open,
  onToggle,
  compact,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  rule?: RuleKey;
  open?: boolean;
  onToggle?: (rule: RuleKey) => void;
  /**
   * One line, label beside value, on a phone. Stacked labels cost 34px of vertical space each and
   * there are nine of them above the map — which is how the map ended up below the fold on the one
   * screen size where the map is hardest to read in the first place.
   */
  compact?: boolean;
}) {
  const { teach } = useTeach();
  const clickable = Boolean(rule && onToggle && teach);
  if (compact) {
    return (
      <span
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
        onClick={clickable ? () => onToggle!(rule!) : undefined}
        onKeyDown={
          clickable
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") onToggle!(rule!);
              }
            : undefined
        }
        title={hint}
        style={{ fontSize: 12.5, whiteSpace: "nowrap", cursor: clickable ? "pointer" : undefined }}
      >
        <span style={{ color: "#8a8172" }}>{label} </span>
        <span
          style={{
            fontSize: 14,
            fontVariantNumeric: "tabular-nums",
            textDecoration: clickable ? "underline dotted" : undefined,
            textDecorationColor: open ? INK : "#cfc5b2",
            textUnderlineOffset: 4,
          }}
        >
          {value}
        </span>
      </span>
    );
  }
  return (
    <div style={{ minWidth: 76 }}>
      <Label>{label}</Label>
      <div
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
        onClick={clickable ? () => onToggle!(rule!) : undefined}
        onKeyDown={
          clickable
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") onToggle!(rule!);
              }
            : undefined
        }
        style={{
          fontSize: 20,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.2,
          cursor: clickable ? "pointer" : undefined,
          textDecoration: clickable ? "underline dotted" : undefined,
          textDecorationColor: open ? INK : "#cfc5b2",
          textUnderlineOffset: 5,
        }}
        title={hint}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Which figure's rule is open, for the whole page.
 *
 * The explanation is drawn in one stable slot below the map so opening it never shifts the map,
 * legend or inspector unpredictably.
 */
export interface RuleSlot {
  open: { civ: CivId; rule: RuleKey } | null;
  toggle: (civ: CivId, rule: RuleKey) => void;
  close: () => void;
}

function useRuleSlot(): RuleSlot {
  const [open, setOpen] = useState<{ civ: CivId; rule: RuleKey } | null>(null);
  const toggle = useCallback(
    (civ: CivId, rule: RuleKey) =>
      setOpen((current) => (current?.civ === civ && current.rule === rule ? null : { civ, rule })),
    [],
  );
  const close = useCallback(() => setOpen(null), []);
  return { open, toggle, close };
}

function Toggle({
  on,
  onClick,
  children,
  small,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  small?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        border: `1px solid ${on ? INK : RULE}`,
        background: on ? INK : "transparent",
        color: on ? PAPER : INK,
        borderRadius: 2,
        padding: small ? "3px 7px" : "4px 10px",
        fontSize: small ? 11 : 12,
        cursor: "pointer",
        touchAction: "manipulation",
      }}
    >
      {children}
    </button>
  );
}

function MapStepButton({
  children,
  onClick,
  label,
  on,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  on?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{
        width: 26,
        height: 24,
        border: `1px solid ${RULE}`,
        background: on ? INK : "transparent",
        color: on ? PAPER : INK,
        fontSize: 11,
        lineHeight: 1,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function Playhead({
  turn,
  max,
  landmarks,
  onScrub,
  playing,
  onTogglePlay,
  condensed = false,
}: {
  turn: number;
  max: number;
  landmarks: Landmark[];
  onScrub: (turn: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
  /**
   * Pinned above an open record on a phone, where every pixel this block keeps is a pixel of the
   * record. The named landmark list goes; the ticks that are actually scrub targets stay, and the
   * names come back the moment the record is closed.
   */
  condensed?: boolean;
}) {
  const { landmark, lang, t } = useLang();
  const { teach } = useTeach();
  return (
    <div style={{ position: "relative", padding: condensed ? "12px 0 2px" : "18px 0 6px" }}>
      <div style={{ position: "relative", height: 16 }}>
        {landmarks.map((mark) => (
          <button
            key={`${mark.kind}-${mark.civ}`}
            onClick={() => onScrub(mark.turn)}
            title={`${landmark(mark.kind)} · ${mark.turn}`}
            style={{
              position: "absolute",
              left: `${max > 0 ? (mark.turn / max) * 100 : 0}%`,
              transform: "translateX(-50%)",
              width: 9,
              height: 9,
              padding: 0,
              borderRadius: 9,
              border: `1px solid ${mark.civ ? CIV_COLOUR[mark.civ] : INK}`,
              background: PAPER,
              cursor: "pointer",
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* Transport controls, ported from the first build. A season is 150 turns of small changes;
            dragging a slider one notch at a time is not how anybody watches that. Play advances a
            turn a second and stops of its own accord at the newest turn, so it never fights the
            live season for the playhead. */}
        <MapStepButton onClick={() => onScrub(Math.max(0, turn - 1))} label={lang === "zh" ? "前一回合" : "previous turn"}>
          ‹
        </MapStepButton>
        <MapStepButton
          onClick={onTogglePlay}
          label={playing ? (lang === "zh" ? "暫停" : "pause") : lang === "zh" ? "播放" : "play"}
          on={playing}
        >
          {playing ? "❚❚" : "▶"}
        </MapStepButton>
        <MapStepButton onClick={() => onScrub(Math.min(max, turn + 1))} label={lang === "zh" ? "下一回合" : "next turn"}>
          ›
        </MapStepButton>
        <input
          type="range"
          min={0}
          max={Math.max(0, max)}
          value={turn}
          onChange={(event) => onScrub(Number(event.target.value))}
          style={{ flex: 1, accentColor: INK }}
        />
        <span style={{ fontSize: 11.5, color: "#8a8172", minWidth: 52, textAlign: "right" }}>
          {turn} / {max}
        </span>
      </div>
      {/* The ticks above are the reason anyone scrubs, and a bare circle says nothing about what it
          marks. Naming them turns the slider into a table of contents for the season. */}
      {teach && !condensed && landmarks.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 16px", marginTop: 2 }}>
          <span style={{ fontSize: 11, color: "#8a8172", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            {t("landmarksTitle")}
          </span>
          {landmarks.map((mark) => (
            <button
              key={`label-${mark.kind}-${mark.civ}`}
              onClick={() => onScrub(mark.turn)}
              style={{
                border: "none",
                background: "transparent",
                padding: 0,
                fontSize: 11.5,
                cursor: "pointer",
                color: mark.civ ? CIV_COLOUR[mark.civ] : INK,
                fontFamily: "inherit",
              }}
            >
              {landmark(mark.kind)}
              {mark.civ ? <span style={{ opacity: 0.75 }}>（{civLabel(mark.civ, lang)}）</span> : null}{" "}
              <span style={{ color: "#8a8172" }}>{mark.turn}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TurnGutter({
  frame,
  status,
  slot,
  row = false,
  compact = false,
}: {
  frame: ReplayFrame;
  status: SeasonStatus | null;
  slot: RuleSlot;
  row?: boolean;
  compact?: boolean;
}) {
  const { t } = useLang();
  const gap = frame.frame.civs.north.nearestGap;
  const contact = frame.frame.civs.north.contact || frame.frame.civs.south.contact;
  return (
    <div
      style={{
        width: row ? "100%" : 132,
        display: "flex",
        flexDirection: row ? "row" : "column",
        alignItems: row ? (compact ? "baseline" : "flex-end") : "center",
        justifyContent: row ? "flex-start" : undefined,
        gap: row ? (compact ? "4px 14px" : 24) : 18,
        paddingTop: row ? (compact ? 6 : 8) : 26,
        textAlign: row ? "left" : "center",
        flexWrap: "wrap",
      }}
    >
      <Stat label={t("turn")} value={frame.turn} compact={compact} />
      <Stat
        label={t("gap")}
        value={gap === undefined ? "—" : `${gap}`}
        hint={t("ofTiles")}
        rule="gap"
        open={slot.open?.rule === "gap"}
        onToggle={(rule) => slot.toggle("north", rule)}
        compact={compact}
      />
      <div style={{ fontSize: compact ? 12 : 11, color: contact ? INK : "#8a8172" }}>
        {contact ? t("contact") : t("noContact")}
      </div>
      {status ? (
        <div style={{ fontSize: compact ? 12 : 11, color: "#8a8172" }}>
          {status.status === "active" ? t("live") : status.status === "paused" ? t("paused") : t("finished")}
        </div>
      ) : null}
    </div>
  );
}

function CivHeader({
  civ,
  frame,
  slot,
  compact = false,
}: {
  civ: CivId;
  frame: ReplayFrame;
  slot: RuleSlot;
  compact?: boolean;
}) {
  const { lang, t } = useLang();
  const stats = frame.frame.civs[civ];
  const toggle = (rule: RuleKey) => slot.toggle(civ, rule);
  const isOpen = (rule: RuleKey) => slot.open?.civ === civ && slot.open.rule === rule;
  return (
    <div
      style={{
        display: "flex",
        gap: compact ? "4px 14px" : 20,
        alignItems: compact ? "baseline" : "flex-end",
        marginBottom: 8,
        flexWrap: "wrap",
      }}
    >
      <div style={{ fontSize: compact ? 14 : 20, color: CIV_COLOUR[civ], whiteSpace: "nowrap" }}>
        {believesLabel(civ, lang)}
      </div>
      <Stat
        label={t("workers")}
        value={`${stats.workers} / ${frame.slots[civ]}`}
        rule="workers"
        open={isOpen("workers")}
        onToggle={toggle}
        compact={compact}
      />
      <Stat
        label={t("food")}
        value={stats.food}
        rule="food"
        open={isOpen("food")}
        onToggle={toggle}
        compact={compact}
      />
      <Stat
        label={t("stone")}
        value={stats.stone}
        rule="stone"
        open={isOpen("stone")}
        onToggle={toggle}
        compact={compact}
      />
      <Stat
        label={`${t("seen")} 🔒`}
        value={stats.seenTiles ?? "—"}
        hint={t("hiddenFromModels")}
        rule="seen"
        open={isOpen("seen")}
        onToggle={toggle}
        compact={compact}
      />
    </div>
  );
}

/**
 * The truth view is the only omniscient surface on the page, so it is labelled as such rather than
 * borrowing one civilization's heading — a reader must never mistake it for somebody's belief.
 */
function TruthHeader({
  frame,
  slot,
  compact = false,
}: {
  frame: ReplayFrame;
  slot: RuleSlot;
  compact?: boolean;
}) {
  const { lang, t } = useLang();
  return (
    <div style={{ marginBottom: 8 }}>
      {/* The heading owns its own line. Sharing a wrapping flex row with the two civ groups put
          "事實" beside north and dropped south onto a second row, so the two sides — which exist
          to be compared — were drawn in different registers. */}
      <div style={{ fontSize: compact ? 14 : 20, whiteSpace: "nowrap", marginBottom: compact ? 2 : 6 }}>
        {t("truth")}
      </div>
      <div
        style={{
          display: "flex",
          gap: compact ? "2px 20px" : 28,
          alignItems: compact ? "baseline" : "flex-end",
          flexWrap: "wrap",
        }}
      >
        {/* Two labelled figures per side, never one compound number: "14 · 184" is unreadable
            without the hover a phone does not have. */}
        {(["north", "south"] as CivId[]).map((civ) => {
          const toggle = (rule: RuleKey) => slot.toggle(civ, rule);
          const isOpen = (rule: RuleKey) => slot.open?.civ === civ && slot.open.rule === rule;
          return (
            <div
              key={civ}
              style={{
                display: "flex",
                gap: compact ? 10 : 14,
                alignItems: compact ? "baseline" : "flex-end",
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  color: CIV_COLOUR[civ],
                  whiteSpace: "nowrap",
                  paddingBottom: compact ? 0 : 2,
                }}
              >
                {civLabel(civ, lang)}
              </div>
              <Stat
                label={t("workers")}
                value={`${frame.frame.civs[civ].workers} / ${frame.slots[civ]}`}
                rule="workers"
                open={isOpen("workers")}
                onToggle={toggle}
                compact={compact}
              />
              <Stat
                label={t("food")}
                value={frame.frame.civs[civ].food}
                rule="food"
                open={isOpen("food")}
                onToggle={toggle}
                compact={compact}
              />
              <Stat
                label={t("stone")}
                value={frame.frame.civs[civ].stone}
                rule="stone"
                open={isOpen("stone")}
                onToggle={toggle}
                compact={compact}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The one place a rule explanation is ever drawn, so no column can be pushed out of step. */
function RuleSlotPanel({ frame, slot, protocolVersion }: { frame: ReplayFrame; slot: RuleSlot; protocolVersion: number }) {
  const { lang } = useLang();
  if (!slot.open) return null;
  const { civ, rule } = slot.open;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "#8a8172", textTransform: "uppercase" }}>
        {civLabel(civ, lang)}
      </div>
      <RulePanel
        rule={rule}
        context={{ civ: frame.frame.civs[civ], slots: frame.slots[civ], turn: frame.turn, protocolVersion }}
      />
    </div>
  );
}

function Page() {
  const { lang, setLang, t } = useLang();
  const { teach, setTeach } = useTeach();
  const { seasonId, seasons } = useSeasonParam();
  const [status, setStatus] = useState<SeasonStatus | null>(null);
  const [series, setSeries] = useState<SeriesPoint[] | null>(null);
  const [tiles, setTiles] = useState<Tile[] | null>(null);
  const [protocolVersion, setProtocolVersion] = useState<number | null>(null);
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);
  const [turn, setTurn] = useState<number>(0);
  const [frame, setFrame] = useState<ReplayFrame | null>(null);
  const [detail, setDetail] = useState<TurnDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [view, setView] = useState<View>("north");
  const [outlineTruth, setOutlineTruth] = useState(false);
  const [showIntent, setShowIntent] = useState(true);
  const [selection, setSelection] = useState<Selection | undefined>();
  const [panel, setPanel] = useState<PanelName>("now");
  const ruleSlot = useRuleSlot();
  const pinned = useRef(false);
  /** The map + playhead block. It pins itself to the top while a record is open below it. */
  const stageRef = useRef<HTMLDivElement | null>(null);
  /** Its measured height, so the record's own heading can pin directly beneath it. */
  const [stageHeight, setStageHeight] = useState(0);
  const hadSelection = useRef(false);

  /**
   * Whether this season's map holds food that never regrows. Before `corridor-oasis` (v24) every
   * food cell had an income, so the map's round/angular grammar had nothing to say about food and
   * the legend should not raise it. Measured from the terrain rather than from a protocol number,
   * because it is a property of the seed.
   */
  const finiteFood = useMemo(
    () => (tiles ? tiles.some((tile) => tile.node?.kind === "food" && tile.node.regen <= 0) : false),
    [tiles],
  );

  useEffect(() => {
    if (!seasonId) return;
    api.status(seasonId).then((next) => {
      setStatus(next);
      if (!pinned.current && next) {
        const requested = new URLSearchParams(window.location.search).get("turn");
        setTurn(requested ? Number(requested) : next.currentTurn);
        pinned.current = true;
      }
    });
    api.terrain(seasonId).then((world) => {
      setTiles(world?.tiles ?? null);
      setProtocolVersion(world?.protocolVersion ?? null);
    });
    api.landmarks(seasonId).then((list) => setLandmarks(list ?? []));
    // One query for the whole season. Both the charts and the turn summary read these rows, so the
    // page owns the fetch rather than each of them asking for the same thing.
    fetch(`/api/research/series?seasonId=${encodeURIComponent(seasonId)}`, {
      headers: { Accept: "application/json" },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => setSeries(payload as SeriesPoint[] | null));
  }, [seasonId]);

  // Poll for a new turn without ever moving the reader's view.
  useEffect(() => {
    if (!seasonId) return;
    const timer = setInterval(() => {
      api.status(seasonId).then((next) => next && setStatus(next));
    }, 25_000);
    return () => clearInterval(timer);
  }, [seasonId]);

  useEffect(() => {
    if (!seasonId) return;
    let cancelled = false;
    api.replay(seasonId, turn).then((next) => {
      if (cancelled) return;
      setMissing(next === null);
      if (next) setFrame(next);
    });
    return () => {
      cancelled = true;
    };
  }, [seasonId, turn]);

  // The turn's results are fetched once here because two surfaces read them: the spine renders them
  // by engine stage, and the inspector attributes them to the one worker under the cursor.
  useEffect(() => {
    if (!seasonId) return;
    let cancelled = false;
    fetch(`/api/research/turn-detail?seasonId=${encodeURIComponent(seasonId)}&turn=${turn}`, {
      headers: { Accept: "application/json" },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!cancelled) setDetail(payload as TurnDetail | null);
      });
    return () => {
      cancelled = true;
    };
  }, [seasonId, turn]);

  const scrub = useCallback((next: number) => setTurn(Math.max(0, next)), []);

  // Auto-advance. It stops itself at the newest turn rather than trailing a live season, because a
  // playhead that keeps moving on its own is the "live mode" this page deliberately does not have.
  const [playing, setPlaying] = useState(false);
  const maxTurn = status?.currentTurn ?? turn;
  useEffect(() => {
    if (!playing) return;
    if (turn >= maxTurn) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setTurn((value) => Math.min(maxTurn, value + 1)), 900);
    return () => clearTimeout(timer);
  }, [playing, turn, maxTurn]);
  const switchView = useCallback(
    (next: View) => {
      setView(next);
      setSelection(undefined);
      ruleSlot.close();
    },
    [ruleSlot.close],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") scrub(turn - 1);
      if (event.key === "ArrowRight") scrub(turn + 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [turn, scrub]);

  const behind = status ? status.currentTurn - turn : 0;
  const views: View[] = useMemo(() => ["north", "south", "truth"], []);
  const { width: windowWidth, height: windowHeight } = useWindowSize();
  const mapSize = singleMapSize(windowWidth);
  const beside = windowWidth >= STACK_BREAKPOINT;
  const narrow = windowWidth < NARROW_BREAKPOINT;
  const fullMapHeight = mapStageHeight(windowHeight, mapSize, narrow);
  // Stacked and inspecting: the map splits the screen with the record instead of preceding it.
  const splitStage = !beside && !!selection;
  const mapHeight = splitStage ? inspectMapHeight(windowHeight, fullMapHeight) : fullMapHeight;

  // A new selection on a stacked screen brings the stage to the top of the viewport, so the pinned
  // map and the first line of the record land on the same screen without the reader chasing either.
  // It fires on the selected tile, not on every render, or reading a long record would keep
  // yanking the page back up. Anything the reader has scrolled past above the map is theirs to
  // scroll back to; the map is the only thing the record needs beside it.
  const selectionKey = selection ? `${selection.kind}:${selection.id ?? ""}:${selection.x},${selection.z}` : "";
  useEffect(() => {
    if (beside) return;
    // Closing returns to the same place, because the map has just grown back to full height under a
    // reader who was several screens into a record. Never on the first render, where there is no
    // selection to have closed and the masthead should still be the first thing on the page.
    const closing = !selectionKey;
    if (closing && !hadSelection.current) return;
    hadSelection.current = !!selectionKey;
    const stage = stageRef.current;
    if (!stage) return;
    const target = stage.getBoundingClientRect().top + window.scrollY - 4;
    if (Math.abs(window.scrollY - target) < 8) return;
    window.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, [selectionKey, beside]);

  // Measured rather than computed: the block is a canvas plus a control row whose height depends on
  // the language, the teaching switch and whether the season is behind. A number typed here would
  // be wrong for one of those on the first change.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setStageHeight(stage.offsetHeight));
    observer.observe(stage);
    setStageHeight(stage.offsetHeight);
    return () => observer.disconnect();
  }, [splitStage]);

  if (!seasonId) return <Shell>{t("noSeason")}</Shell>;
  if (!tiles || !frame) return <Shell>{t("loading")}</Shell>;

  // One element, rendered in whichever of the two places this screen has room for. It is written
  // once so the two layouts cannot drift apart in what they pass it.
  const inspector = (
    <Inspector
      seasonId={seasonId}
      frame={frame.frame}
      tiles={tiles}
      turn={turn}
      selection={selection}
      view={view}
      detail={detail}
      protocolVersion={protocolVersion ?? 16}
      beside={beside}
      stickyTop={splitStage ? stageHeight : undefined}
      onClear={() => setSelection(undefined)}
      onSelect={setSelection}
    />
  );

  return (
    <Shell>
      {/* The masthead is deliberately short. On a phone each of the four items used to claim its own
          line, so the title block alone was 200px and the map opened below the fold — the exact
          thing the layout change was meant to fix. The season and both models share one wrapping
          row instead, and the title shrinks with the screen. */}
      <header
        style={{
          display: "flex",
          alignItems: narrow ? "center" : "flex-end",
          gap: beside ? 24 : 10,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: beside ? 26 : narrow ? 17 : 20, letterSpacing: "0.02em" }}>{t("title")}</div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: narrow ? 8 : 14,
            flexWrap: "wrap",
            fontSize: beside ? 12 : narrow ? 10.5 : 11,
            flex: narrow ? "1 1 100%" : undefined,
            order: narrow ? 3 : undefined,
          }}
        >
          <SeasonPicker seasonId={seasonId} seasons={seasons} />
          {status?.slots.map((slot) => (
            <span key={slot.civ}>
              <span style={{ color: "#8a8172" }}>{civLabel(slot.civ, lang)} </span>
              <span style={{ color: CIV_COLOUR[slot.civ] }}>{slot.model}</span>
            </span>
          ))}
        </div>
        {/* Only the two page-wide switches live up here. 「真相輪廓」 and 「意圖線」 draw things on
            the map and nothing else, so they moved down against the map itself — on a phone they
            were two of the four chips that pushed the map below the fold, and pressing one changed
            something the reader could not see. */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Toggle on={teach} onClick={() => setTeach(!teach)}>
            {t("teach")}
          </Toggle>
          <Toggle on={false} onClick={() => setLang(lang === "zh" ? "en" : "zh")}>
            {lang === "zh" ? "EN" : "中文"}
          </Toggle>
        </div>
      </header>

      {/* Everything that describes the map sits in the map's own column, and the lens switch sits
          directly on top of it (Shek's call, 2026-08-07). It used to be at the top of the page with
          the premise, the playhead and the milestone rail between it and the map, so pressing
          「南原所信」 changed something the reader could not see without scrolling. A control
          belongs against the thing it controls. The premise and the playhead moved below the stage
          for the same reason: nothing that is not the map may push the map off the first screen.

          Previously the turn gutter also ran the full 1180px while the header was centred with the
          map, so on a wide screen the two rows started ~190px apart with a fixed 112px of reserved
          emptiness between them — which reads as a broken block rather than a heading. Both are now
          flush with the map's left edge and flow naturally. */}
      <div
        style={{
          display: "flex",
          gap: MAP_GUTTER,
          alignItems: "flex-start",
          justifyContent: "center",
          flexWrap: "wrap",
        }}
      >
        <div style={{ width: mapSize, maxWidth: "100%" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {views.map((option) => (
              <Toggle key={option} on={view === option} onClick={() => switchView(option)}>
                {option === "truth" ? t("truth") : believesLabel(option as CivId, lang)}
              </Toggle>
            ))}
            <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {view !== "truth" ? (
                <Toggle small on={outlineTruth} onClick={() => setOutlineTruth((value) => !value)}>
                  {t("showTruth")}
                </Toggle>
              ) : null}
              <Toggle small on={showIntent} onClick={() => setShowIntent((value) => !value)}>
                {t("showIntent")}
              </Toggle>
            </span>
          </div>
          <div style={{ marginTop: narrow ? 6 : 10 }}>
            <TurnGutter frame={frame} status={status} slot={ruleSlot} row compact={narrow} />
          </div>
          <div style={{ marginTop: narrow ? 4 : 10 }}>
            {view === "truth" ? (
              <TruthHeader frame={frame} slot={ruleSlot} compact={narrow} />
            ) : (
              <CivHeader civ={view as CivId} frame={frame} slot={ruleSlot} compact={narrow} />
            )}
          </div>
          {/* The map and the playhead travel together. On a stacked screen with a record open they
              pin to the top of the viewport as one block, so the reader can scrub turns and watch
              both the map and the record change without leaving either. */}
          <div
            ref={stageRef}
            style={
              splitStage
                ? {
                    position: "sticky",
                    top: 0,
                    zIndex: 3,
                    background: PAPER,
                    paddingBottom: 6,
                    boxShadow: `0 6px 0 ${PAPER}`,
                  }
                : undefined
            }
          >
            <BeliefMap
              tiles={tiles}
              frame={frame.frame}
              view={view}
              outlineTruth={view === "truth" ? false : outlineTruth}
              showIntent={showIntent}
              selection={selection}
              onSelect={setSelection}
              width={mapSize}
              height={mapHeight}
            />
            <Playhead
              turn={turn}
              max={maxTurn}
              landmarks={landmarks}
              onScrub={scrub}
              playing={playing}
              onTogglePlay={() => setPlaying((value) => !value)}
              condensed={splitStage}
            />
          </div>
          {missing ? <div style={{ fontSize: 13, color: "#8a8172" }}>{t("turnMissing")}</div> : null}
          {behind > 0 && status?.status === "active" ? (
            <button
              onClick={() => scrub(status.currentTurn)}
              style={{
                marginTop: 10,
                width: "100%",
                border: `1px solid ${RULE}`,
                background: "transparent",
                color: INK,
                padding: "6px 10px",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {lang === "zh"
                ? `第 ${status.currentTurn} 回合已到 · ${t("jumpToNow")}`
                : `Turn ${status.currentTurn} has landed · ${t("jumpToNow")}`}
            </button>
          ) : null}
          <RuleSlotPanel frame={frame} slot={ruleSlot} protocolVersion={protocolVersion ?? 16} />
          {/* Stacked, the record is the first thing under the pinned map — not the last thing under
              the caption, the legend and everything else that describes the map. Those keep their
              place below it, where a reader who is not inspecting anything still finds them in the
              same order. */}
          {beside ? null : inspector}
          <Caption>{t("capMaps")}</Caption>
          {/* Beside the map the legend goes in the inspector's column — see below. */}
          {beside ? null : <Legend showIntent={showIntent} outlineTruth={outlineTruth} finiteFood={finiteFood} />}
        </div>

        {/* The record of what you clicked, beside the thing you clicked — while there is a column to
            put it in. Below the breakpoint that column does not exist, so the record moves into the
            map's own column directly under the map, which pins itself instead. */}
        {beside ? (
          <div
            style={{
              width: INSPECTOR_WIDTH,
              flex: "0 0 auto",
              position: "sticky",
              top: 12,
              alignSelf: "flex-start",
            }}
          >
            {inspector}
            {/* With nothing selected this column was 380 × 760 of blank paper beside the densest
                surface on the page, while the key to that surface sat below the fold under the map.
                The legend belongs next to the thing it explains wherever there is room for it. */}
            <div style={{ marginTop: 14 }}>
              <Legend showIntent={showIntent} outlineTruth={outlineTruth} finiteFood={finiteFood} />
            </div>
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 16 }}>
        <Note label={lang === "zh" ? "這是什麼實驗？" : "what is this experiment?"}>
          {t("premise", { hours: RULES.hoursPerTurn })}
        </Note>
      </div>

      {/* Below the map the page used to be one 12,000-pixel scroll of fourteen sections — on a
          phone, fourteen screens of it, and no way to tell where you were or what was still coming.
          The sections have not changed and nothing is hidden; they are grouped by the question they
          answer and only one group is drawn at a time (Shek's call, 2026-08-08).

          Every panel stays mounted and is hidden with `display: none` rather than unmounted. Each
          of these sections fetches its own rows, and unmounting would refetch the whole season
          every time a reader looked at the other tab. */}
      <Panels active={panel} onChange={setPanel} panels={PANELS} lang={lang}>
        <Panel active={panel} name="now">
          {/* The two questions a reader has the moment they have seen the map — can they eat, and
              is home running out. This is the state of the world at the turn on the playhead. */}
          <Vitals frame={frame.frame} tiles={tiles} />
          <Summary frame={frame.frame} series={series} turn={turn} slots={frame.slots} protocolVersion={protocolVersion ?? 16} />
          <ResourceBars frame={frame.frame} slots={frame.slots} protocolVersion={protocolVersion ?? 16} />
          <TurnSpine turn={turn} frame={frame.frame} slots={frame.slots} detail={detail} protocolVersion={protocolVersion ?? 16} />
        </Panel>

        <Panel active={panel} name="season">
          <SinceLastVisit
            seasonId={seasonId}
            currentTurn={status?.currentTurn ?? turn}
            landmarks={landmarks}
            onScrub={scrub}
          />
          <Effort seasonId={seasonId} turn={turn} maxTurn={maxTurn} onScrub={scrub} />
          <Logistics seasonId={seasonId} turn={turn} maxTurn={maxTurn} onScrub={scrub} />
          <Charts
            seasonId={seasonId}
            series={series}
            turn={turn}
            maxTurn={status?.currentTurn ?? turn}
            onScrub={scrub}
          />
          <Loom
            seasonId={seasonId}
            turn={turn}
            maxTurn={status?.currentTurn ?? turn}
            onScrub={scrub}
            selectedWorker={selection?.id}
            onSelectWorker={(workerId) => {
              const worker = frame.frame.workers.find((entry) => entry.id === workerId);
              if (!worker) return;
              setView(worker.owner);
              setSelection({ kind: "worker", id: workerId, x: worker.x, z: worker.z });
            }}
          />
        </Panel>

        <Panel active={panel} name="models">
          {/* "What did each side do" has to be on screen before "what was it worth" can mean
              anything, so the season's shape sits in the tab before this one. */}
          <Efficiency seasonId={seasonId} turn={turn} />
          <Pressure
            seasonId={seasonId}
            frame={frame.frame}
            tiles={tiles}
            turn={turn}
            maxTurn={status?.currentTurn ?? turn}
            protocolVersion={protocolVersion ?? 16}
            onScrub={scrub}
          />
          <Ceilings tiles={tiles} protocolVersion={protocolVersion} />
        </Panel>

        <Panel active={panel} name="words">
          <Journals frame={frame} />
          {/* The journal above is one turn of the model's own claim. Everything it keeps *across*
              turns — standing orders, notebook, chronicle, and the journal in full — sits below,
              because a claim made at turn 20 that is still being quoted at turn 200 is a finding
              and it is unreadable one turn at a time. */}
          <Notebooks
            seasonId={seasonId}
            turn={turn}
            maxTurn={status?.currentTurn ?? turn}
            active={panel === "words"}
          />
          {/* A journal is what a civilization told itself; a letter is what it told the other side.
              They are different claims and the gap between them is worth reading, so they sit in
              the same panel with the private record first. */}
          <Correspondence seasonId={seasonId} turn={turn} protocolVersion={protocolVersion ?? 16} />
          <TrendNotes seasonId={seasonId} />
        </Panel>

        <Panel active={panel} name="rules">
          <Rules protocolVersion={protocolVersion ?? 16} />
        </Panel>
      </Panels>
    </Shell>
  );
}

/**
 * The five questions the page below the map answers, in the order a reader arrives at them: what is
 * happening now, what has happened all season, how the two models compare, what they said about it,
 * and what the rules are.
 */
const PANELS = [
  { name: "now", zh: "這一回合", en: "this turn" },
  { name: "season", zh: "整季", en: "the season" },
  { name: "models", zh: "兩個模型", en: "the two models" },
  { name: "words", zh: "它們怎麼說", en: "what they said" },
  { name: "rules", zh: "規則", en: "the rules" },
] as const;

type PanelName = (typeof PANELS)[number]["name"];

function Panel({
  active,
  name,
  children,
}: {
  active: PanelName;
  name: PanelName;
  children: React.ReactNode;
}) {
  return <div style={{ display: active === name ? undefined : "none" }}>{children}</div>;
}

/**
 * The switcher sticks to the top of the viewport, because a reader who has scrolled to the bottom of
 * a long panel and wants the next question should not have to scroll back up to find the control
 * that changes it.
 */
function Panels({
  active,
  onChange,
  panels,
  lang,
  children,
}: {
  active: PanelName;
  onChange: (name: PanelName) => void;
  panels: typeof PANELS;
  lang: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <nav
        style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          display: "flex",
          gap: 2,
          flexWrap: "wrap",
          margin: "18px 0 0",
          padding: "8px 0 6px",
          background: PAPER,
          borderBottom: `1px solid ${RULE}`,
        }}
      >
        {panels.map((entry) => (
          <button
            key={entry.name}
            onClick={() => onChange(entry.name)}
            aria-current={active === entry.name}
            style={{
              border: "none",
              borderBottom: `2px solid ${active === entry.name ? INK : "transparent"}`,
              background: "transparent",
              color: active === entry.name ? INK : "#8a8172",
              padding: "5px 10px",
              fontSize: 13,
              fontFamily: "inherit",
              cursor: "pointer",
              touchAction: "manipulation",
            }}
          >
            {lang === "zh" ? entry.zh : entry.en}
          </button>
        ))}
      </nav>
      {children}
    </>
  );
}

/**
 * What each model said it was doing, beside what the engine actually did. The two are given
 * different registers on purpose: a journal is the model's own claim and may be wrong, while an
 * event is what happened. Never merge them — the mismatch is one of the findings.
 */
function Journals({ frame }: { frame: ReplayFrame }) {
  const { lang, t } = useLang();
  const { width } = useWindowSize();
  return (
    <section style={{ borderTop: `1px solid ${RULE}`, marginTop: 20, paddingTop: 16 }}>
      <Caption>{t("capJournals")}</Caption>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: width < STACK_BREAKPOINT ? "1fr" : "1fr 1fr",
          gap: 24,
        }}
      >
        {(["north", "south"] as CivId[]).map((civ) => {
          const events = frame.frame.events.filter((event) => event.civ === civ);
          const journal = frame.frame.journal[civ];
          return (
            <div key={civ}>
              <div style={{ fontSize: 16, color: CIV_COLOUR[civ], marginBottom: 8 }}>
                {civLabel(civ, lang)}
              </div>
              <Label>{t("modelSays")}</Label>
              <div
                style={{
                  fontStyle: "italic",
                  background: "#f2ece0",
                  border: `1px solid ${RULE}`,
                  padding: "8px 10px",
                  fontSize: 13,
                  lineHeight: 1.5,
                  margin: "4px 0 12px",
                }}
              >
                {journal || "—"}
              </div>
              <Label>{t("whatHappened")}</Label>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
                {events.length === 0 ? (
                  <li style={{ color: "#8a8172" }}>—</li>
                ) : (
                  events.slice(0, 12).map((event) => (
                    <li key={event.id}>
                      <span style={{ color: "#8a8172" }}>{event.kind}</span> ·{" "}
                      {translateEventText(event.text, lang).text}
                    </li>
                  ))
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: PAPER,
        color: INK,
        // Sans throughout (Shek's call, 2026-08-07). The paper palette carries the "instrument on
        // paper" feel on its own; the serif was costing legibility on the dense figure rows and on
        // Traditional Chinese at 11–13px, where Songti's thin strokes disappear.
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang TC', 'Noto Sans TC', 'Microsoft JhengHei', Helvetica, Arial, sans-serif",
        padding: "20px 16px 64px",
        // `clip`, never `hidden`. `overflow-x: hidden` silently computes overflow-y to `auto`,
        // which makes this div a scroll container that never scrolls — and any `position: sticky`
        // inside it (the inspector column) then sticks to a box that never moves, i.e. not at all.
        // `clip` suppresses the same horizontal overflow without creating a scrollport.
        overflowX: "clip",
      }}
    >
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>{children}</div>
    </div>
  );
}

export default function V3() {
  return (
    <V3LangProvider>
      <TeachProvider>
        <Page />
      </TeachProvider>
    </V3LangProvider>
  );
}
