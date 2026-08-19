import { MIN_BLOCKS, RULES, SIGHT, workerSight } from "../sim/config";
import type { CivFrame } from "../sim/types";
import type { Lang } from "./lang";

/**
 * Every explanation on the page, in one file, in both languages.
 *
 * The rule the page shows is never a formula printed as a formula — it is the mechanism written
 * out with *this* civilization's numbers already substituted in, so a reader learns the rule by
 * watching it run rather than by reading a definition. `−12（12 人 × 1）` teaches upkeep silently;
 * "each worker eats 1 food per turn" does not.
 *
 * Every constant is read from `config.ts`, so an explanation can never drift from the engine. If a
 * rule changes, this file changes with it and nothing has to be remembered.
 *
 * Explanations live here rather than in `lang.tsx` because a rule is a paragraph with arithmetic in
 * it, not a label: keeping the two languages side by side in one function is the only way to notice
 * when one of them stops matching the other.
 */

export interface Explanation {
  /** The mechanism in one sentence, with no numbers from this season in it. */
  rule: string;
  /** The same mechanism, one line per step, with this civilization's figures substituted. */
  steps: string[];
}

export interface RuleContext {
  civ: CivFrame;
  /** Worker places this civilization currently has. Protocol 10+ fixes this at the natural ceiling. */
  slots: number;
  turn: number;
  protocolVersion?: number | null;
}

export type RuleKey =
  | "food"
  | "stone"
  | "workers"
  | "capacity"
  | "seen"
  | "gap"
  | "blocks"
  | "harvest"
  | "carried";

type Builder = (context: RuleContext, lang: Lang) => Explanation;

const zh = (lang: Lang) => lang === "zh";

/** Food: what leaves the store before anybody decides anything, and how long the rest lasts. */
const food: Builder = ({ civ }, lang) => {
  const burn = civ.workers * RULES.upkeep;
  const runway = burn > 0 ? Math.floor(civ.food / burn) : 0;
  return zh(lang)
    ? {
        rule: `每個工人每回合吃 ${RULES.upkeep} 份糧食，在任何人作決定之前就直接從倉存扣除。糧食不足的回合最多餓死 ${RULES.starvationToll} 人。`,
        steps: [
          `${civ.workers} 人 × ${RULES.upkeep} ＝ 每回合 ${burn} 糧`,
          `倉存 ${civ.food} ÷ ${burn || 1} ＝ 還可以撐 ${runway} 個回合（若完全沒有新收成）`,
          `背包裡另有 ${civ.carried}，但背包裡的東西不能吃，要先入倉才算數`,
        ],
      }
    : {
        rule: `Every worker eats ${RULES.upkeep} food per turn, taken from the store before either side decides anything. A hungry turn kills at most ${RULES.starvationToll} worker.`,
        steps: [
          `${civ.workers} workers × ${RULES.upkeep} = ${burn} food per turn`,
          `${civ.food} stored ÷ ${burn || 1} = ${runway} turns of runway with no further harvest`,
          `${civ.carried} more sits in backpacks, and backpack food cannot be eaten — it has to be deposited first`,
        ],
      };
};

/** Stone: finite, and the only thing that buys capacity. */
const stone: Builder = ({ civ }, lang) => {
  const blocks = Math.floor(civ.stone / RULES.blockCost);
  return zh(lang)
    ? {
        rule: `石材來自石礦，一名工人一回合只採 ${RULES.gatherStone}，而且永遠不會再生。每塊建材 ${RULES.blockCost} 石。`,
        steps: [
          `倉存 ${civ.stone} 石 ÷ ${RULES.blockCost} ＝ 可以砌 ${blocks} 塊`,
          `家門口的石礦還剩 ${civ.quarryLeft}（用完就沒有了）`,
          `一座倉庫最少 ${MIN_BLOCKS.store} 塊，即最少 ${MIN_BLOCKS.store * RULES.blockCost} 石`,
        ],
      }
    : {
        rule: `Stone comes from quarries, a worker gathers only ${RULES.gatherStone} per turn, and it never regrows. Every block costs ${RULES.blockCost} stone.`,
        steps: [
          `${civ.stone} stored ÷ ${RULES.blockCost} = ${blocks} blocks`,
          `${civ.quarryLeft} left in the home quarry, and nothing replaces it`,
          `A store needs at least ${MIN_BLOCKS.store} blocks — ${MIN_BLOCKS.store * RULES.blockCost} stone`,
        ],
      };
};

/** Population: the four gates, spelled out with the numbers that are about to be tested. */
const workers: Builder = ({ civ, slots, turn, protocolVersion }, lang) => {
  const protocol = protocolVersion ?? 16;
  const nextCheck =
    turn % RULES.migrationInterval === 0
      ? turn
      : turn + (RULES.migrationInterval - (turn % RULES.migrationInterval));
  const threshold = RULES.migrationFoodCost + (civ.workers + 1) * RULES.migrationReserveTurns * RULES.upkeep;
  if (protocol >= 16) {
    return zh(lang)
      ? {
          rule: `人口不是文明決定的——動作表上沒有「造人」。規則每 ${RULES.migrationInterval} 回合檢查一次；需要建築容量、落腳地、連續 ${RULES.famineRecoveryTurns} 回合交足口糧，以及足夠支付加入成本和儲備的存糧。`,
          steps: [
            `下一次檢查：第 ${nextCheck} 回合`,
            `容量：現在 ${civ.workers} 人，共 ${slots} 個位置；位置＝已完成建築站立方塊總數 ÷ 3 向下取整`,
            `若下一人加入，存糧門檻是 ${RULES.migrationFoodCost} ＋ ${civ.workers + 1} 人 × ${RULES.migrationReserveTurns} 回合 ＝ ${threshold}`,
            `加入時扣除 ${RULES.migrationFoodCost} 糧；任何短缺都會重新計算連續餵飽回合`,
          ],
        }
      : {
          rule: `Population is not a civilization action. Every ${RULES.migrationInterval} turns the engine checks building-derived capacity, open ground, a ${RULES.famineRecoveryTurns}-turn fully-fed streak, and stored food for the joining cost plus reserve.`,
          steps: [
            `Next check: turn ${nextCheck}`,
            `Capacity: ${civ.workers} living, ${slots} places; places = floor(standing blocks in completed structures ÷ 3)`,
            `For one more person the stored-food threshold is ${RULES.migrationFoodCost} + ${civ.workers + 1} people × ${RULES.migrationReserveTurns} turns = ${threshold}`,
            `Joining spends ${RULES.migrationFoodCost}; any food shortfall restarts the fully-fed streak`,
          ],
        };
  }
  if (protocol >= 15) {
    return zh(lang)
      ? {
          rule: `人口不是文明決定的——動作表上沒有「造人」。規則每 ${RULES.migrationInterval} 回合檢查一次；需要建築容量、落腳地，以及飢荒後連續 ${RULES.famineRecoveryTurns} 回合交足口糧，才有一個孩子免費長大成人。`,
          steps: [
            `下一次檢查：第 ${nextCheck} 回合`,
            `容量：現在 ${civ.workers} 人，共 ${slots} 個位置；位置＝已完成建築站立方塊總數 ÷ 3 向下取整`,
            `不收加入費用；任何口糧短缺都會重新計算連續餵飽回合`,
            `聚居地旁必須有空地讓新人站——這一格只有引擎知道`,
          ],
        }
      : {
          rule: `Population is not a civilization action. Every ${RULES.migrationInterval} turns, one child comes of age at no cost when building-derived capacity, open ground and a ${RULES.famineRecoveryTurns}-turn fully-fed streak are all available.`,
          steps: [
            `Next check: turn ${nextCheck}`,
            `Capacity: ${civ.workers} living, ${slots} places; places = floor(standing blocks in completed structures ÷ 3)`,
            `Joining is free; any food shortfall restarts the fully-fed streak`,
            `Open ground beside the settlement for the newcomer to stand on — only the engine knows this one`,
          ],
        };
  }
  return zh(lang)
    ? {
        rule: `人口不是文明決定的——動作表上沒有「造人」。規則每 ${RULES.migrationInterval} 回合檢查一次；有位置、有落腳地，而且飢荒後已連續 ${RULES.famineRecoveryTurns} 回合交足口糧，就有一個孩子長大成人加入，不收費用。`,
        steps: [
          `下一次檢查：第 ${nextCheck} 回合`,
          `位置：現在 ${civ.workers} 人，共固定 ${slots} 個位置`,
          `飢荒後要連續交足 ${RULES.famineRecoveryTurns} 回合口糧；任何短缺都會重新計算`,
          `聚居地旁必須有空地讓新人站——這一格只有引擎知道`,
        ],
      }
    : {
        rule: `Population is not something a civilization decides — there is no "make a person" action. Every ${RULES.migrationInterval} turns, a child comes of age at no cost when there is room, open ground and a ${RULES.famineRecoveryTurns}-turn fully-fed streak after famine.`,
        steps: [
          `Next check: turn ${nextCheck}`,
          `Places: ${civ.workers} living, ${slots} fixed places`,
          `After famine, ${RULES.famineRecoveryTurns} fully fed turns are required; any shortfall restarts the count`,
          `Open ground beside the settlement for the newcomer to stand on — only the engine knows this one`,
        ],
      };
};

/** Storage: local structures whose totals are aggregated for the spectator. */
const capacity: Builder = ({ civ }, lang) => {
  const cap = civ.storageCapacity ?? RULES.hallStorageCapacity;
  const fromStores = Math.max(0, cap - RULES.hallStorageCapacity);
  const used = civ.food + civ.stone;
  return zh(lang)
    ? {
        rule: `每座實體倉存各有自己的容量，內裡由糧食與石材共用。工人必須走到有空位的自家倉存才能卸貨；畫面只把各座容量與存量加總顯示。`,
        steps: [
          `總容量 ${cap} ＝ 聚居地 ${RULES.hallStorageCapacity} ＋ 各座倉庫 ${fromStores}`,
          `已用 ${used} ＝ 糧食 ${civ.food} ＋ 石材 ${civ.stone}`,
          `背包裡還有 ${civ.carried}；加總容量${used + civ.carried > cap ? "不足" : "足夠"}，實際仍要有一座可到達而且有本地空位的倉存`,
          `囤太多石材會直接擠走糧食的空間`,
        ],
      }
    : {
        rule: `Each physical storage structure has its own capacity, shared locally by food and stone. A worker must reach an owned structure with room to unload; the spectator only aggregates their totals.`,
        steps: [
          `Total capacity ${cap} = settlement ${RULES.hallStorageCapacity} + stores ${fromStores}`,
          `Used ${used} = food ${civ.food} + stone ${civ.stone}`,
          `${civ.carried} still in backpacks; aggregate capacity is ${used + civ.carried > cap ? "insufficient" : "sufficient"}, but an actual deposit still needs one reachable structure with local room`,
          `Hoarding stone takes the room food would have used`,
        ],
      };
};

/** Knowledge: a number the models are never told. */
const seen: Builder = ({ civ, protocolVersion }, lang) => {
  const total = RULES.width * RULES.height;
  const share = Math.round(((civ.seenTiles ?? 0) / total) * 100);
  const currentWorkerSight = workerSight(protocolVersion ?? 16);
  return zh(lang)
    ? {
        rule: `每一方只知道自己親眼看過的地方。工人看 ${currentWorkerSight} 格，聚居地看 ${SIGHT.hall} 格，哨站看 ${SIGHT.post} 格，倉庫看 ${SIGHT.store} 格。離開視線後那塊地變成記憶，顯示的是最後一次見到的樣子。`,
        steps: [
          `已見過 ${civ.seenTiles ?? 0} 格 ／ 全圖 ${total} 格 ＝ ${share}%`,
          `這個數字是我們從外面數出來的，模型自己看不到`,
          `記憶會過時，而過時的記憶一樣會拿來做決定`,
        ],
      }
    : {
        rule: `Each side knows only what its own people have laid eyes on. A worker sees ${currentWorkerSight} tiles, a settlement ${SIGHT.hall}, a post ${SIGHT.post}, and a store ${SIGHT.store}. Once out of sight, ground becomes memory and shows how it last looked.`,
        steps: [
          `${civ.seenTiles ?? 0} tiles ever seen of ${total} = ${share}%`,
          `We count this from outside; the model is never told it`,
          `Memory goes stale, and a stale memory is still used to decide`,
        ],
      };
};

/** The gap: the measurement the whole experiment turns on. */
const gap: Builder = ({ civ }, lang) => {
  const value = civ.nearestGap;
  return zh(lang)
    ? {
        rule: `兩方最近的一對在生工人之間的距離。沒有任何規則要求他們走近——起步距離由每季地圖量度，會不會相遇是觀察結果，不是設定。`,
        steps: [
          value === undefined ? "其中一方已經沒有在生工人，無法量度" : `目前 ${value} 格`,
          `工人一回合走 ${RULES.workerMove} 格`,
          `平線代表兩方從未互相靠近`,
        ],
      }
    : {
        rule: `The distance between the nearest pair of living workers. No rule asks them to close it — the opening distance is measured from that season's map, and whether they ever meet is an observation rather than a setting.`,
        steps: [
          value === undefined ? "One side has no living workers, so there is nothing to measure" : `${value} tiles right now`,
          `A worker walks ${RULES.workerMove} tiles per turn`,
          `A flat line means the two sides never approached each other`,
        ],
      };
};

/** Construction: stone has to be physically walked to the site. */
const blocks: Builder = ({ civ }, lang) =>
  zh(lang)
    ? {
        rule: `建築不會即時出現。文明自己畫設計圖，工人把石材一趟趟搬到工地，每人每回合砌 ${RULES.buildRate} 塊，中途一直看得見。新工地只可以開在自家聚居地或已完成倉庫 ${RULES.buildRadius} 格之內。哨站只負責觀察。`,
        steps: [
          `已建 ${civ.blocksPlaced} 塊，被拆走 ${civ.blocksTaken} 塊`,
          `每塊 ${RULES.blockCost} 石；拆自己的只取回 ${RULES.salvage} 石，是蝕本回收`,
          `建築是實心的，任何人都走不過去——包括建它的人`,
        ],
      }
    : {
        rule: `Buildings do not appear. A civilization draws its own blueprint, workers carry stone to the site trip by trip, and each places ${RULES.buildRate} blocks per turn in plain view. New work may start only within ${RULES.buildRadius} tiles of its hall or a completed store. A post observes only.`,
        steps: [
          `${civ.blocksPlaced} blocks standing, ${civ.blocksTaken} taken apart`,
          `${RULES.blockCost} stone each; taking one of your own apart returns only ${RULES.salvage} — recycling at a loss`,
          `A building is solid and nobody walks through it, including its owner`,
        ],
      };

/** Harvest: why one field cannot feed one full-time farmer. */
const harvest: Builder = (_context, lang) =>
  zh(lang)
    ? {
        rule: `一名工人一回合採 ${RULES.gatherFood} 糧或 ${RULES.gatherStone} 石。每格糧地有自己的上限及再生速度，再生可以是 0；石礦永遠不會再生。`,
        steps: [
          `地圖和 Inspector 逐格顯示「現量／上限」及每回合再生量，不用全圖共用一個假定數字`,
          `再生 0 的糧地是一次性存貨；有正再生的糧地才是長期收入`,
          `被建築壓住的農地停止回復`,
        ],
      }
    : {
        rule: `A worker gathers ${RULES.gatherFood} food or ${RULES.gatherStone} stone per turn. Every food cell has its own cap and regrowth rate, which may be zero; quarries never regrow.`,
        steps: [
          `The map and Inspector show each cell's current amount, cap and per-turn regrowth instead of applying one assumed rate to the whole world`,
          `Zero-regrowth food is one-off stock; only positive-regrowth food is continuing income`,
          `A field with a block on it stops regrowing`,
        ],
      };

/** Carrying: the distinction three seasons died inside. */
const carried: Builder = ({ civ }, lang) =>
  zh(lang)
    ? {
        rule: `採到的東西要工人親自搬回聚居地或倉庫才算數。工人一回合走 ${RULES.workerMove} 格，身上最多帶 ${RULES.carry}。背包裡的糧食不能吃。`,
        steps: [
          `目前有 ${civ.carried} 份物資在背包裡，還沒有入倉`,
          `這些東西不計入倉存，餓死時亦幫不到手`,
          `工人餓死時，背包裡的東西會跌在原地，變成任何一方都可以拾走的物資堆`,
        ],
      }
    : {
        rule: `Nothing counts until a worker physically carries it back to a settlement or store. A worker walks ${RULES.workerMove} tiles per turn and carries at most ${RULES.carry}. Food in a backpack cannot be eaten.`,
        steps: [
          `${civ.carried} units are in backpacks and have not been deposited`,
          `That total is not part of the store and does not stop anyone starving`,
          `When a worker starves its load falls where it stood, and either side may pick it up`,
        ],
      };

const BUILDERS: Record<RuleKey, Builder> = {
  food,
  stone,
  workers,
  capacity,
  seen,
  gap,
  blocks,
  harvest,
  carried,
};

export function explain(key: RuleKey, context: RuleContext, lang: Lang): Explanation {
  return BUILDERS[key](context, lang);
}
