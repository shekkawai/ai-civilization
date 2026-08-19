import { CIV_COLOUR } from "./BeliefMap";
import { Caption, RuleNote } from "./RuleNote";
import { civLabel, useLang } from "./lang";
import { useNarrow } from "./responsive";
import { translateEventText } from "../lib/game-events";
import { RULES } from "../sim/config";
import type { CivId, Frame } from "../sim/types";

/**
 * A turn always resolves in the same order, so it is rendered in that order — upkeep, regrowth,
 * orders, movement, carrying, gathering, construction, removal/repair, migration check. A reader
 * learns the shape once and can then read any turn at a glance.
 *
 * Refusals get equal billing with successes: "asked for and did not get", in the engine's own
 * words, with a counter when the same code repeats. Today that is the most informative data in the
 * system and it has been the least visible.
 */

const RULE = "#ded5c4";
const INK = "#2b2723";
const MUTED = "#8a8172";

export interface ActionResultRow {
  id: number;
  civ: CivId;
  actionType: string;
  status: string;
  code: string;
  text: string;
  workerIds?: string[];
}

export interface TurnDetail {
  turn: number;
  results: ActionResultRow[];
  events: Array<{ id: number; civ?: CivId; kind: string; text: string }>;
}

/** The stages the engine runs, in engine order. */
const STAGES: Array<{ key: string; kinds: string[]; codes: string[] }> = [
  { key: "upkeep", kinds: ["starve"], codes: [] },
  // Vision is recomputed before anybody decides anything, so a first sighting belongs above the
  // orders it goes on to change. A letter sent this turn is shown with the orders that sent it.
  { key: "sighting", kinds: ["contact"], codes: [] },
  { key: "orders", kinds: ["message"], codes: ["job_assigned", "deposit_assigned", "worksite_created", "worksite_resumed", "design_saved", "notebook_updated", "name_saved", "message_queued"] },
  { key: "gathering", kinds: ["gather"], codes: ["gathered"] },
  { key: "carrying", kinds: ["deposit", "spill", "drop"], codes: ["deposited", "material_delivered", "material_withdrawn", "goods_dropped", "nothing_to_drop", "pile_collected"] },
  { key: "construction", kinds: ["build", "complete"], codes: ["blocks_built"] },
  { key: "removalRepair", kinds: ["removal", "repair"], codes: ["blocks_removed", "blocks_repaired"] },
  { key: "migrationCheck", kinds: ["migration"], codes: [] },
];

function Row({ children, tint }: { children: React.ReactNode; tint?: string }) {
  return (
    <div style={{ fontSize: 13, lineHeight: 1.6, color: tint ?? INK }}>{children}</div>
  );
}

/**
 * The engine writes its text into the database in Traditional Chinese and every recorded season
 * already holds Chinese rows, so English mode reformats the known shapes at read time. A sentence
 * no pattern matched is shown as the engine wrote it and marked as such rather than left to look
 * like a translation that came out in the wrong language.
 */
export function EngineText({ text }: { text: string }) {
  const { lang, t } = useLang();
  const { text: rendered, translated } = translateEventText(text, lang);
  if (translated) return <>{rendered}</>;
  return (
    <span title={t("originalText")} style={{ textDecoration: "underline dotted", textDecorationColor: RULE }}>
      {rendered}
    </span>
  );
}

/**
 * The turn's results are fetched by the page rather than here, because the inspector reads the same
 * rows to attribute what happened to one worker. One number, one home — and one request.
 */
export function TurnSpine({
  turn,
  frame,
  slots,
  detail,
  protocolVersion,
}: {
  turn: number;
  frame: Frame;
  slots: Record<CivId, number>;
  detail: TurnDetail | null;
  protocolVersion: number;
}) {
  const { t, lang } = useLang();
  const narrow = useNarrow();

  if (!detail) return null;

  return (
    <section style={{ borderTop: `1px solid ${RULE}`, marginTop: 20, paddingTop: 16 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.08em", color: MUTED, textTransform: "uppercase", marginBottom: 10 }}>
        {t("turnSpine")} · {turn}
      </div>
      <Caption>{t("capSpine")}</Caption>

      {STAGES.map((stage) => {
        const events = detail.events.filter((event) => stage.kinds.includes(event.kind));
        const results = detail.results.filter(
          (result) => stage.codes.includes(result.code) && result.status !== "rejected" && result.status !== "failed",
        );
        const empty = events.length === 0 && results.length === 0;
        return (
          <div
            key={stage.key}
            style={{
              display: "grid",
              // A fixed 132px label column costs a third of a phone's width and leaves the engine's
              // own sentences wrapping four words at a time. Below the breakpoint the stage name
              // becomes a heading over its rows instead.
              gridTemplateColumns: narrow ? "1fr" : "132px 1fr",
              gap: narrow ? 2 : 12,
              padding: "5px 0",
              borderTop: `1px solid #efe9dd`,
              opacity: empty ? 0.45 : 1,
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: MUTED,
                letterSpacing: "0.04em",
                paddingTop: 2,
                textTransform: narrow ? "uppercase" : undefined,
              }}
            >
              {t(`stage_${stage.key}` as never)}
            </div>
            <div>
              {empty ? (
                <Row tint={MUTED}>—</Row>
              ) : (
                <>
                  {events.map((event) => (
                    <Row key={`e${event.id}`}>
                      {event.civ ? (
                        <span style={{ color: CIV_COLOUR[event.civ] }}>{civLabel(event.civ, lang)} </span>
                      ) : null}
                      <EngineText text={event.text} />
                    </Row>
                  ))}
                  {summarise(results).map((line) => (
                    <Row key={line.key}>
                      <span style={{ color: CIV_COLOUR[line.civ] }}>{civLabel(line.civ, lang)} </span>
                      <EngineText text={line.text} />
                      {line.count > 1 ? <span style={{ color: MUTED }}> ×{line.count}</span> : null}
                    </Row>
                  ))}
                </>
              )}
            </div>
          </div>
        );
      })}

      <Refusals detail={detail} />
      <Gates frame={frame} detail={detail} slots={slots} protocolVersion={protocolVersion} />
    </section>
  );
}

/** Same code, same civ, one line with a count — a turn can carry a dozen identical results. */
function summarise(results: ActionResultRow[]) {
  const map = new Map<string, { key: string; civ: CivId; text: string; count: number }>();
  for (const result of results) {
    const key = `${result.civ}-${result.code}`;
    const known = map.get(key);
    if (known) known.count += 1;
    else map.set(key, { key, civ: result.civ, text: result.text, count: 1 });
  }
  return [...map.values()];
}

function Refusals({ detail }: { detail: TurnDetail }) {
  const { t, lang } = useLang();
  const refused = detail.results.filter(
    (result) => result.status === "rejected" || result.status === "failed",
  );
  const grouped = summarise(refused);
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.08em", color: MUTED, textTransform: "uppercase" }}>
        {t("refusals")}
      </div>
      {grouped.length === 0 ? (
        <Row tint={MUTED}>{t("noRefusals")}</Row>
      ) : (
        grouped.map((line) => (
          <Row key={line.key}>
            <span style={{ color: CIV_COLOUR[line.civ] }}>{civLabel(line.civ, lang)} </span>
            <EngineText text={line.text} />
            {line.count > 1 ? <span style={{ color: MUTED }}> ×{line.count}</span> : null}
          </Row>
        ))
      )}
    </div>
  );
}

/**
 * The migration gate, evaluated live with this civilization's own numbers. Nobody has to read a
 * rules page: they watch the condition fail. Three of the four gates are exactly computable from
 * the frame; the fourth — whether open ground exists beside the settlement — is only knowable from
 * the engine, so it is shown only when the engine actually reported on it that turn.
 */
function Gates({
  frame,
  detail,
  slots,
  protocolVersion,
}: {
  frame: Frame;
  detail: TurnDetail;
  slots: Record<CivId, number>;
  protocolVersion: number;
}) {
  const { t, lang } = useLang();
  const checkTurn = frame.turn % RULES.migrationInterval === 0;
  return (
    <div style={{ marginTop: 14 }}>
      <Caption>{t("capGates")}</Caption>
      {/* auto-fit rather than a fixed pair, so the two checklists stack on a phone instead of
          squeezing "✓ Enough food stored · 402 / 95" into 170px. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20 }}>
      {(["north", "south"] as CivId[]).map((civ) => {
        const stats = frame.civs[civ];
        const places = slots[civ];
        const noGroundEvent = detail.events.find(
          (event) => event.civ === civ && event.kind === "migration" && event.text.includes("空地"),
        );
        const joined = detail.events.find(
          (event) => event.civ === civ && event.kind === "migration" && !event.text.includes("沒有"),
        );
        const gates = [
          { ok: checkTurn, label: t("gateEvenTurn"), detail: `${frame.turn}` },
          { ok: stats.workers < places, label: t("gateRoom"), detail: `${stats.workers} / ${places}` },
          ...(protocolVersion >= 16
            ? [
                {
                  ok: stats.food >= (stats.migrationFoodRequired ?? Number.POSITIVE_INFINITY),
                  label: t("gateStoredFood"),
                  detail: `${stats.food} / ${stats.migrationFoodRequired ?? "—"}`,
                },
              ]
            : []),
          ...(noGroundEvent ? [{ ok: false, label: t("gateGround"), detail: "" }] : []),
        ];
        return (
          <div key={civ}>
            <div style={{ fontSize: 11, letterSpacing: "0.08em", color: MUTED, textTransform: "uppercase" }}>
              {civLabel(civ, lang)} · {t("gateTitle")}
            </div>
            {gates.map((gate) => (
              <div key={gate.label} style={{ fontSize: 13, lineHeight: 1.6 }}>
                <span style={{ color: gate.ok ? "#5a7a3f" : "#a8492c" }}>{gate.ok ? "✓" : "✗"}</span> {gate.label}
                {gate.detail ? <span style={{ color: MUTED }}> · {gate.detail}</span> : null}
              </div>
            ))}
            <div style={{ fontSize: 13, marginTop: 2 }}>
              → {joined ? t("gateJoined") : t("gateNobody")}
            </div>
            <RuleNote rule="workers" context={{ civ: stats, slots: places, turn: frame.turn, protocolVersion }} />
          </div>
        );
        })}
      </div>
    </div>
  );
}
