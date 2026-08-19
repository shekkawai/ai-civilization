import { useEffect, useRef } from "react";
import { RULES } from "../sim/config";
import { bleach, CIV_COLOUR, PAPER, TERRAIN } from "./BeliefMap";
import { useLang } from "./lang";
import { DRAIN, drawNode, levelLabel, type Level } from "./resource";
import { useTeach } from "./RuleNote";
import { useNarrow } from "./responsive";
import { drawWorkerMark, type WorkerMark } from "./worker";
import type { Resource } from "../sim/types";

/**
 * What the marks on the map mean.
 *
 * The map is the densest surface on the page and was, until now, the only one with nothing
 * explaining it: a reader saw green dots, blue and rust squares, a pale halo and a bleached
 * surround, and had to guess at every one of them. A legend is not decoration here — the fog is the
 * subject of the site, and fog you cannot read is just a dark patch.
 */

const MUTED = "#8a8172";
const INK_2 = "#55524a";

function Swatch({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 12,
        height: 12,
        marginRight: 6,
        verticalAlign: "-2px",
        border: "1px solid rgba(43,39,35,0.18)",
      }}
    >
      {children}
    </span>
  );
}

/**
 * The legend's resource marks are drawn by the map's own `drawNode`, on a small canvas, rather than
 * reproduced in CSS. A legend that redraws its subject by hand drifts from it on the first change;
 * this one cannot.
 */
const GLYPH = 18;
function NodeGlyph({ kind, level, renews = true }: { kind: Resource; level: Level; renews?: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = GLYPH * ratio;
    canvas.height = GLYPH * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, GLYPH, GLYPH);
    // The ground is half the mark: the map drains the tile as well as shrinking the glyph, so a
    // legend showing only the glyph would teach half the scheme.
    context.fillStyle = bleach(kind === "food" ? TERRAIN.field : TERRAIN.stone, DRAIN[level]);
    context.fillRect(0, 0, GLYPH, GLYPH);
    drawNode(context, kind, level, GLYPH / 2, GLYPH / 2, GLYPH, renews);
  }, [kind, level, renews]);
  return (
    <canvas
      ref={ref}
      style={{ width: GLYPH, height: GLYPH, marginRight: 4, verticalAlign: "-5px", display: "inline-block" }}
    />
  );
}

/**
 * A person, drawn by the map's own `drawWorkerMark` for the same reason the node glyphs are: a
 * legend that reproduces its subject by hand drifts from it on the first change.
 */
function WorkerGlyph({ mark, ground = TERRAIN.grass }: { mark: WorkerMark; ground?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = GLYPH * ratio;
    canvas.height = GLYPH * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, GLYPH, GLYPH);
    context.fillStyle = ground;
    context.fillRect(0, 0, GLYPH, GLYPH);
    drawWorkerMark(context, GLYPH / 2, GLYPH / 2, GLYPH, mark, PAPER, "#2b2723");
  }, [mark, ground]);
  return (
    <canvas
      ref={ref}
      style={{ width: GLYPH, height: GLYPH, marginRight: 5, verticalAlign: "-5px", display: "inline-block" }}
    />
  );
}

/**
 * `nowrap` keeps a mark welded to its label, which is right for every short entry. A sentence-long
 * one has to be allowed to wrap or it runs off the column and the reader loses the end of it.
 */
function Item({ swatch, label, wrap }: { swatch: React.ReactNode; label: string; wrap?: boolean }) {
  return (
    <span
      style={{
        fontSize: 11.5,
        color: INK_2,
        whiteSpace: wrap ? "normal" : "nowrap",
        marginRight: 18,
        lineHeight: 2,
      }}
    >
      {swatch}
      {label}
    </span>
  );
}

export function Legend({
  showIntent,
  outlineTruth,
  finiteFood,
}: {
  showIntent: boolean;
  outlineTruth: boolean;
  /**
   * Whether this season's map holds any food cell that never regrows. Twenty-one seasons had none,
   * and printing a mark that appears nowhere on the map is worse than printing nothing: a legend
   * is read as a description of what is on screen.
   */
  finiteFood: boolean;
}) {
  const { t, lang } = useLang();
  const { teach } = useTeach();
  const narrow = useNarrow();
  const zh = lang === "zh";
  if (!teach) return null;
  return (
    // Twenty-odd marks and four paragraphs. On a desk that is a key beside the map; on a phone it is
    // three screens of small print between the map and everything the map is evidence for. It folds
    // (Shek's call, 2026-08-08) — open where there is room, one tap where there is not.
    <details open={!narrow} style={{ margin: "10px 0 4px", maxWidth: "84ch" }}>
      <summary
        style={{
          cursor: "pointer",
          listStyle: "none",
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: MUTED,
          padding: "3px 0",
        }}
      >
        {zh ? "地圖圖例" : "map legend"}
      </summary>
      <div style={{ display: "flex", flexWrap: "wrap" }}>
        <Item swatch={<Swatch><span style={{ display: "block", width: "100%", height: "100%", background: TERRAIN.field }} /></Swatch>} label={t("legField")} />
        <Item swatch={<Swatch><span style={{ display: "block", width: "100%", height: "100%", background: TERRAIN.oasis }} /></Swatch>} label={t("legOasis")} />
        <Item swatch={<Swatch><span style={{ display: "block", width: "100%", height: "100%", background: TERRAIN.stone }} /></Swatch>} label={t("legStoneGround")} />
        <Item swatch={<Swatch><span style={{ display: "block", width: "100%", height: "100%", background: TERRAIN.water }} /></Swatch>} label={t("legWater")} />
        <Item swatch={<Swatch><span style={{ display: "block", width: "100%", height: "100%", background: TERRAIN.ridge }} /></Swatch>} label={t("legRidge")} />
        <Item swatch={<Swatch><span style={{ display: "block", width: "100%", height: "100%", background: CIV_COLOUR.north }} /></Swatch>} label={t("legBlockNorth")} />
        <Item swatch={<Swatch><span style={{ display: "block", width: "100%", height: "100%", background: CIV_COLOUR.south }} /></Swatch>} label={t("legBlockSouth")} />
        <Item
          swatch={<WorkerGlyph mark={{ colour: CIV_COLOUR.north, food: 0, stone: 0, stalled: false }} />}
          label={t("legWorkerOwn")}
        />
        <Item
          swatch={<WorkerGlyph mark={{ food: 0, stone: 0, stalled: false }} />}
          label={t("legWorkerSeen")}
        />
        <Item
          swatch={
            <WorkerGlyph
              mark={{ colour: CIV_COLOUR.north, food: RULES.carry * 0.65, stone: 0, stalled: false }}
            />
          }
          label={t("legLoad")}
        />
        <Item
          swatch={<WorkerGlyph mark={{ colour: CIV_COLOUR.north, food: 0, stone: 0, stalled: true }} />}
          label={t("legStalled")}
        />
        <Item
          swatch={
            <span
              style={{
                display: "inline-block",
                marginRight: 6,
                verticalAlign: "-1px",
                fontSize: 10,
                fontWeight: 700,
                padding: "0 3px",
                border: "1px solid rgba(43,39,35,0.45)",
              }}
            >
              ×N
            </span>
          }
          label={t("legStack")}
        />
        <Item
          swatch={
            <span style={{ display: "inline-block", marginRight: 6, verticalAlign: "-2px" }}>
              <span
                style={{
                  display: "inline-block",
                  width: 11,
                  borderTop: `2px solid ${CIV_COLOUR.north}`,
                  verticalAlign: "3px",
                }}
              />
              <span
                style={{
                  display: "inline-block",
                  width: 11,
                  borderTop: `2px dashed ${CIV_COLOUR.north}`,
                  opacity: 0.55,
                  verticalAlign: "3px",
                }}
              />
            </span>
          }
          label={t("legRoute")}
          wrap
        />
      </div>
      <p style={{ margin: "2px 0 0", fontSize: 11.5, lineHeight: 1.6, color: MUTED }}>{t("legLoadNote")}</p>
      {/* Resources get their own row. Sharing the terrain row buried the one distinction the map
          exists to draw — where the food is against where the stone is — among nine other marks. */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", marginTop: 2 }}>
        {[
          {
            key: "food",
            kind: "food" as Resource,
            renews: true,
            label: finiteFood ? ("legFood" as const) : ("legFoodPlain" as const),
          },
          ...(finiteFood
            ? [{ key: "food-finite", kind: "food" as Resource, renews: false, label: "legFoodFinite" as const }]
            : []),
          { key: "stone", kind: "stone" as Resource, renews: false, label: "legStone" as const },
        ].map((row) => (
          <span
            key={row.key}
            style={{ fontSize: 11.5, color: INK_2, whiteSpace: "nowrap", marginRight: 20, lineHeight: 2 }}
          >
            <span style={{ marginRight: 4 }}>{t(row.label)}</span>
            {(["full", "mid", "low", "spent"] as Level[]).map((level) => (
              <span key={level} style={{ marginRight: 8 }}>
                <NodeGlyph kind={row.kind} level={level} renews={row.renews} />
                {levelLabel(level, zh)}
              </span>
            ))}
          </span>
        ))}
        <span style={{ fontSize: 11.5, color: MUTED }}>{t("legNode")}</span>
      </div>
      {/* The shape rule is only worth a sentence on a map that actually contains both kinds. Where
          every field regrows, "round means it comes back" is a distinction without a difference. */}
      {finiteFood ? (
        <p style={{ margin: "4px 0 0", fontSize: 11.5, lineHeight: 1.6, color: MUTED }}>{t("legShape")}</p>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", marginTop: 2 }}>
        <Item
          swatch={
            <Swatch>
              <span style={{ display: "block", width: "100%", height: "100%", background: "#e2e0cb", outline: "1px solid rgba(43,39,35,0.62)" }} />
            </Swatch>
          }
          label={t("legVisible")}
        />
        <Item
          swatch={
            <Swatch>
              <span
                style={{
                  display: "block",
                  width: "100%",
                  height: "100%",
                  background: "repeating-linear-gradient(135deg, #eee9dc 0 3px, #cfc8b9 3px 4px)",
                }}
              />
            </Swatch>
          }
          label={t("legMemory")}
        />
        <Item swatch={<Swatch><span style={{ display: "block", width: "100%", height: "100%", background: "#f4efe4" }} /></Swatch>} label={t("legUnseen")} />
        {outlineTruth ? (
          <Item
            swatch={
              <span
                style={{
                  display: "inline-block",
                  width: 12,
                  height: 12,
                  marginRight: 6,
                  verticalAlign: "-2px",
                  border: "1px solid rgba(43,39,35,0.6)",
                }}
              />
            }
            label={t("legOutline")}
          />
        ) : null}
        {showIntent ? (
          <Item
            swatch={
              <span
                style={{
                  display: "inline-block",
                  width: 12,
                  height: 12,
                  marginRight: 6,
                  verticalAlign: "-2px",
                  borderTop: `1px solid ${CIV_COLOUR.north}`,
                  marginTop: 5,
                }}
              />
            }
            label={t("legIntent")}
          />
        ) : null}
      </div>
      <p style={{ margin: "6px 0 0", fontSize: 11.5, lineHeight: 1.6, color: MUTED }}>{t("lockNote")}</p>
    </details>
  );
}
