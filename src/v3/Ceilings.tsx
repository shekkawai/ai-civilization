import { useMemo } from "react";
import { readMap } from "../lib/strategy";
import { RULES } from "../sim/config";
import { useLang } from "./lang";
import { useTeach } from "./RuleNote";
import type { Tile } from "../sim/types";

/**
 * What this map allows at home.
 *
 * A reader cannot tell whether twelve people is a thriving settlement or a stalled one, because the
 * answer is a property of the terrain rather than of the number. This states the two ceilings the
 * starting position imposes and which one bites first, so every population figure on the page
 * acquires a scale.
 *
 * Everything here is measured from the generated terrain by `readMap`, which is the same reader the
 * old page used. There is no hand-written expectation of what a model "should" do: a ceiling says
 * where the map stops, never whether a decision was good.
 */

const RULE = "#ded5c4";
const MUTED = "#8a8172";
const INK_2 = "#55524a";

export function Ceilings({ tiles, protocolVersion }: { tiles: Tile[]; protocolVersion: number | null }) {
  const { lang, t } = useLang();
  const { teach } = useTeach();
  const facts = useMemo(() => readMap(tiles), [tiles]);
  if (!teach) return null;
  const home = facts.civs.north;
  /**
   * Protocol 10 made worker places a fixed natural ceiling and stopped stores granting any, because
   * while stores added mouths every completed store was strictly self-harm and expanding could not
   * pay. So on those seasons stone does not buy people at all, and a "stone ceiling" of thirteen is
   * a number from a rule the world being shown does not have. Older worlds keep the old card.
   */
  const stoneBuysPlaces = (protocolVersion ?? 3) < 10;
  const structureCapacity = (protocolVersion ?? 3) >= 15;

  /**
   * A ceiling is a rate divided by a rate, and on `corridor-oasis` the numerator is zero — so the
   * card printed "0 people" over three fields holding 270 food, which reads as a broken figure
   * rather than as the finding it is. Where home has no income the honest reading is capital and
   * how long it lasts at the population the rules will produce, plus how far the nearest ground
   * with an income actually is.
   */
  const larderTurns = Math.floor(home.larder / Math.max(1, RULES.naturalCeiling * RULES.upkeep));
  const items = [
    home.homeRenews
      ? {
          label: t("ceilFood"),
          value: lang === "zh" ? `${home.foodCeiling} 人` : `${home.foodCeiling} people`,
          note:
            lang === "zh"
              ? `建造範圍內 ${home.fields} 塊農地，合共每回合回復 ${home.regen} 糧；每人每回合吃 ${RULES.upkeep}。`
              : `${home.fields} fields inside the build radius regrow ${home.regen} food a turn between them; each person eats ${RULES.upkeep}.`,
        }
      : {
          label: t("ceilLarder"),
          value: lang === "zh" ? `${home.larder} 糧，零收入` : `${home.larder} food, no income`,
          note:
            lang === "zh"
              ? `建造範圍內 ${home.fields} 塊農地，合共 ${home.larder} 糧，而且完全不會再生。以 ${RULES.naturalCeiling} 人作比較，每回合吃 ${RULES.naturalCeiling * RULES.upkeep}，即是約 ${larderTurns} 個回合——這是搬遷的本錢，不是可以住下去的收入。`
              : `${home.fields} fields inside the build radius hold ${home.larder} food between them and regrow nothing at all. At a reference population of ${RULES.naturalCeiling}, upkeep is ${RULES.naturalCeiling * RULES.upkeep} a turn, so it is about ${larderTurns} turns — capital for a move, not an income to settle on.`,
        },
    structureCapacity
      ? {
          label: t("ceilStoneBuys"),
          value: lang === "zh" ? `${home.blocks} 格` : `${home.blocks} cells`,
          note:
            lang === "zh"
              ? `家門口 ${home.stone} 石可建 ${home.blocks} 格（每格 ${RULES.blockCost} 石）。人口容量按自家所有已完成建築仍站立的方塊總數 ÷ 3 向下取整；建造現在會增加容量，但亦可能增加持續維修石材。石礦不會再生。`
              : `${home.stone} home stone buys ${home.blocks} cells at ${RULES.blockCost} stone each. Capacity is floor(all standing blocks in completed owned structures ÷ 3): building can now raise it, but may also raise ongoing stone maintenance. Quarries never regrow.`,
        }
      : stoneBuysPlaces
      ? {
          label: t("ceilStone"),
          value: lang === "zh" ? `${home.stoneCeiling} 人` : `${home.stoneCeiling} people`,
          note:
            lang === "zh"
              ? `家門口 ${home.stone} 石 ＝ ${home.blocks} 塊建材；若全部砌成倉庫，每 ${RULES.storeBlocksPerWorkerSlot} 塊多 1 個位置。石礦不會再生。`
              : `${home.stone} stone at home buys ${home.blocks} blocks; spent entirely on stores that is one place per ${RULES.storeBlocksPerWorkerSlot} blocks. Quarries never regrow.`,
        }
      : {
          label: t("ceilStoneBuys"),
          value: lang === "zh" ? `${home.blocks} 格` : `${home.blocks} cells`,
          note:
            lang === "zh"
              ? `家門口 ${home.stone} 石 ＝ ${home.blocks} 塊建材（每格 ${RULES.blockCost} 石）。這一季倉庫不會增加人口位置，人口位置是固定的 ${RULES.naturalCeiling} 個；石材買的是儲存空間同落腳點，不是人。石礦不會再生。`
              : `${home.stone} stone at home buys ${home.blocks} cells at ${RULES.blockCost} stone each. This season stores grant no worker places — places are fixed at ${RULES.naturalCeiling} — so stone buys storage and a foothold, never people. Quarries never regrow.`,
        },
    {
      label: t("ceilNext"),
      value: lang === "zh" ? `${home.nextStone} 格` : `${home.nextStone} tiles`,
      note:
        // Naming only `nextFood` on a map with finite food points a reader at the wrong tile: on
        // `corridor-oasis` the nearest field outside the ring is 16 tiles out and holds 30 food
        // that never comes back, while the nearest ground that could feed anyone is 26.
        lang === "zh"
          ? `家門口石礦用完之後，最近的石材在 ${home.nextStone} 格外；最近的新糧地在 ${home.nextFood} 格外${
              home.nextRenewFood && home.nextRenewFood !== home.nextFood
                ? `，但那一塊也不會再生——最近一塊會再生的在 ${home.nextRenewFood} 格外`
                : ""
            }。工人一回合走 ${RULES.workerMove} 格。`
          : `Once the home quarry is empty the nearest stone is ${home.nextStone} tiles away, the nearest new food ${home.nextFood}${
              home.nextRenewFood && home.nextRenewFood !== home.nextFood
                ? ` — though that one does not regrow either; the nearest that does is ${home.nextRenewFood}`
                : ""
            }. A worker walks ${RULES.workerMove} tiles a turn.`,
    },
  ];

  // "Food binds first: they run out of food, not places" is true but far too mild for a map where
  // home has no income at all — there, food does not bind first, it is the only thing there is.
  const binding = !home.homeRenews
    ? t("ceilBindNoIncome")
    : facts.binding === "both"
      ? t("ceilBindBoth")
      : facts.binding === "stone"
        ? t("ceilBindStone")
        : t("ceilBindFood");

  return (
    <section style={{ borderTop: `1px solid ${RULE}`, marginTop: 20, paddingTop: 16 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.08em", color: MUTED, textTransform: "uppercase", marginBottom: 4 }}>
        {t("ceilTitle")}
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 12.5, lineHeight: 1.65, color: INK_2, maxWidth: "78ch" }}>
        {facts.symmetric ? t("ceilSymmetric") : t("ceilAsymmetric")} {binding}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 28 }}>
        {items.map((item) => (
          <div key={item.label} style={{ maxWidth: "34ch", minWidth: 220, flex: "1 1 240px" }}>
            <div style={{ fontSize: 11, letterSpacing: "0.08em", color: MUTED, textTransform: "uppercase" }}>
              {item.label}
            </div>
            <div style={{ fontSize: 20, fontVariantNumeric: "tabular-nums", lineHeight: 1.3 }}>{item.value}</div>
            <p style={{ margin: "2px 0 0", fontSize: 12, lineHeight: 1.6, color: INK_2 }}>{item.note}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
