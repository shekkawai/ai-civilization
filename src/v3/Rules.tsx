import { useLang } from "./lang";
import { Caption } from "./RuleNote";
import {
  MIN_BLOCKS,
  RULES,
  SIGHT,
  structureUpkeepFreeBlocks,
  usesTightStructureUpkeep,
  workerSight,
} from "../sim/config";

/**
 * The whole rule set, in one place, for human visitors.
 *
 * This is the half of the project's central asymmetry that is easy to forget: **the site explains
 * the economy fully; the agents get none of it.** A reader who does not know that stone never
 * regrows, or that a person is never produced by a command, cannot tell a considered decision from
 * a lucky one — and the individual rule notes scattered beside each figure only ever answer the
 * question a reader already knew to ask.
 *
 * Every number here is read from `config.ts`. Never type a constant into this prose: if a season
 * changes a dial, this page has to change with it and nothing else should have to be remembered.
 * The 🔒 column is the point of the table — it separates what a model is told from what it must
 * work out, and that separation is the experiment.
 */

const RULE = "#ded5c4";
const MUTED = "#8a8172";
const INK_2 = "#4a443c";

interface Line {
  zh: string;
  en: string;
  /** True when the models are never told this. */
  hidden?: boolean;
}

interface Group {
  zh: string;
  en: string;
  lines: Line[];
}

function groups(protocolVersion: number): Group[] {
  const structureCapacity = protocolVersion >= 15;
  const foodGatedPopulation = protocolVersion >= 16;
  const protocol15 = protocolVersion === 15;
  const tightStructureUpkeep = usesTightStructureUpkeep(protocolVersion);
  const currentWorkerSight = workerSight(protocolVersion);
  const upkeepFreeBlocks = structureUpkeepFreeBlocks(protocolVersion);
  const ownRemoveRate = protocol15 ? RULES.protocol15RemoveOwn : RULES.removeOwn;
  return [
    {
      zh: "世界與回合",
      en: "The world and the turn",
      lines: [
        {
          zh: `一張 ${RULES.width} × ${RULES.height} 的地圖，兩個文明各佔一角，地形資源 180° 旋轉對稱——所以螢幕上每一個差異都是模型的選擇，不是地圖的偏袒。`,
          en: `One ${RULES.width} × ${RULES.height} map. The two civilizations sit in opposite corners and the terrain is 180°-symmetric, so every difference on screen is a model's choice rather than the map favouring somebody.`,
        },
        {
          zh: "兩方同時看見同一個凍結的快照，同時決策，然後規則一次過結算。沒有先手。",
          en: "Both sides receive the same frozen snapshot, decide simultaneously, and the rules resolve once. Nobody moves first.",
        },
        {
          zh: `每回合約 ${RULES.hoursPerTurn} 小時。沒有勝利條件，也沒有回合上限；一季在其中一方沒有人時結束。`,
          en: `A turn every ${RULES.hoursPerTurn} hours or so. There is no victory condition and no turn limit; a season ends when one side has no living people.`,
        },
        {
          zh: `地圖有多大、邊界在哪裡——模型從來不知道。報告只說「你的觀察地圖以外是未知」。`,
          en: `How large the map is and where its edges lie are never disclosed. A report says only that anything absent from the observed map is unknown.`,
          hidden: true,
        },
      ],
    },
    {
      zh: "人與糧食",
      en: "People and food",
      lines: [
        {
          zh: `每人每回合吃 ${RULES.upkeep} 糧，在行動之前先扣。糧食不足的回合最多餓死 ${RULES.starvationToll} 人。`,
          en: `Every person eats ${RULES.upkeep} food a turn, taken before anybody acts. A hungry turn kills at most ${RULES.starvationToll} person.`,
        },
        foodGatedPopulation
          ? {
              zh: `每 ${RULES.migrationInterval} 個回合結算一次人口：有空位、落腳地、已連續 ${RULES.famineRecoveryTurns} 回合交足口糧，而且存糧足以支付 ${RULES.migrationFoodCost} 加新增人口之後 ${RULES.migrationReserveTurns} 回合口糧，才有一個成年人加入；加入時扣除 ${RULES.migrationFoodCost} 糧。任何飢荒回合都把連續計數歸零。`,
              en: `Population is checked every ${RULES.migrationInterval} turns. One adult joins only with a free place, open ground, ${RULES.famineRecoveryTurns} consecutive fully fed turns, and stored food covering the ${RULES.migrationFoodCost} joining cost plus ${RULES.migrationReserveTurns} turns for the larger population. Joining spends ${RULES.migrationFoodCost}; any hungry turn resets the streak.`,
            }
          : {
              zh: `每 ${RULES.migrationInterval} 個回合結算一次人口：有空位、落腳地，而且已連續 ${RULES.famineRecoveryTurns} 回合交足口糧，就有一個孩子長大成人加入，不收費用。任何飢荒回合都把連續計數歸零。`,
              en: `Population is checked every ${RULES.migrationInterval} turns: with a free place, open ground and ${RULES.famineRecoveryTurns} consecutive fully fed turns, one child comes of age at no cost. Any hungry turn resets that streak to zero.`,
            },
        {
          zh: "沒有「訓練工人」這個指令。人口是壓力，不是動詞——模型只能把條件做出來，然後等。",
          en: "There is no command to train a worker. Population is pressure, not a verb: a model can only create the conditions and wait.",
        },
        structureCapacity
          ? {
              zh: `開局 ${RULES.startWorkers} 人、${RULES.startFood} 糧、${RULES.startStone} 石。人口容量是自家已完成建築仍然站立的方塊總數 ÷ 3 再向下取整；失去容量時，每次人口結算最多離開一人。`,
              en: `A season opens with ${RULES.startWorkers} people, ${RULES.startFood} food and ${RULES.startStone} stone. Capacity is floor(all standing blocks in completed owned structures ÷ 3); if capacity falls, at most one excess resident leaves per population check.`,
            }
          : {
              zh: `開局 ${RULES.startWorkers} 人、${RULES.startFood} 糧、${RULES.startStone} 石。人口位置固定 ${RULES.naturalCeiling} 個，建築不會增加。`,
              en: `A season opens with ${RULES.startWorkers} people, ${RULES.startFood} food and ${RULES.startStone} stone. Worker places are fixed at ${RULES.naturalCeiling} and building never adds more.`,
            },
      ],
    },
    {
      zh: "採集與搬運",
      en: "Gathering and carrying",
      lines: [
        {
          zh: `一個人每回合走 ${RULES.workerMove} 格，背包上限 ${RULES.carry}。採糧每回合 ${RULES.gatherFood}，採石 ${RULES.gatherStone}。`,
          en: `A person walks ${RULES.workerMove} tiles a turn and carries ${RULES.carry}. Gathering yields ${RULES.gatherFood} food or ${RULES.gatherStone} stone a turn.`,
        },
        {
          zh: "背包裡的東西不能吃、不能用、不能算進存量。物資必須實際走回倉庫，才會成為可用存量——這條規則自己就製造了整個物流問題。",
          en: "Nothing in a backpack can be eaten, spent or counted as stored stock. Goods must physically reach storage before they become usable — that one rule creates the entire logistics problem.",
        },
        {
          zh: `每格糧地都有自己的再生量，也可以是 0；石場永遠不會再生。地圖上的石材是固定總量，用完就沒有。`,
          en: `Every food cell has its own regrowth rate, which may be 0. Stone never regrows: the map holds a fixed total, and once mined it is gone.`,
        },
        {
          zh: "自 v22 起，每格已觀察資源的再生速度與上限都會如實寫進報告（石材永遠是 +0）。模型不知道的，只有它未親眼見過的格。",
          en: "Since v22 the regrowth rate and ceiling of every observed resource cell are stated in the report (stone is always +0). What a model does not know is only the cells its people have not seen.",
        },
        {
          zh: `每座實體倉存建築各有自己的空間，糧食與石材在建築內共用容量。聚居地有 ${RULES.hallStorageCapacity} 格；倉庫按「仍然站立的方塊」每塊有 ${RULES.storeStoragePerBlock} 格。工人要走到有空位的自家倉存才能卸貨；附近滿了便要去另一座。`,
          en: `Each physical storage structure has its own space, shared locally by food and stone. The hall holds ${RULES.hallStorageCapacity}; a store holds ${RULES.storeStoragePerBlock} per standing block. A worker must reach an owned structure with room to unload, and routes elsewhere when the nearby one is full.`,
        },
        ...(protocolVersion >= 18
          ? [
              {
                zh: `同一個背包可以混裝糧食與石材，合計上限仍是 ${RULES.carry}。工人可由糧地 A 改去糧地 B，再改採石；滿載便自動回倉。資源耗盡時模型要在下一次決策指定新採集點，否則原工作會開始回倉。`,
                en: `One backpack may mix food and stone up to the same ${RULES.carry} total. A person may switch from Foodland A to B and then stone; a full load returns automatically. When a source runs out, the model must name another gather target on its next decision or the existing job starts home.`,
              },
            ]
          : []),
      ],
    },
    {
      zh: "建造",
      en: "Building",
      lines: [
        {
          zh: `每格方塊 ${RULES.blockCost} 石，每人每回合放 ${RULES.buildRate} 格。工地未完成前不提供任何功能。`,
          en: `Every cell costs ${RULES.blockCost} stone and a person lays ${RULES.buildRate} a turn. A worksite provides nothing until it is finished.`,
        },
        {
          zh: `倉庫最少 ${MIN_BLOCKS.store} 格、哨站最少 ${MIN_BLOCKS.post} 格、聚居地 ${MIN_BLOCKS.hall} 格；設計最大 ${RULES.maxFootprint} × ${RULES.maxFootprint}、共 ${RULES.maxBlocks} 格。新提交的設計要等下一個回合才能開工。`,
          en: `A store needs at least ${MIN_BLOCKS.store} cells, a post ${MIN_BLOCKS.post}, a hall ${MIN_BLOCKS.hall}. A design may be at most ${RULES.maxFootprint} × ${RULES.maxFootprint} and ${RULES.maxBlocks} cells, and a newly submitted one cannot be built until a later turn.`,
        },
        protocolVersion >= 14
          ? {
              zh: "新工地至少一格必須在目前視野內，而且有工人能走到工地旁的空地；不需要靠近既有建築。哨站只保留視野，不會作為建築錨點。",
              en: "At least one cell of a new worksite must be currently visible and an assigned worker must be able to reach open ground beside it. No completed structure needs to be nearby; a post preserves sight but is not a building anchor.",
            }
          : {
              zh: `新工地必須開在自家聚居地或已完成倉庫 ${RULES.buildRadius} 格以內；哨站只保留視野，不會延伸建築範圍。自家哨站可在原址擴建成倉庫，保留已有方塊。`,
              en: `A new worksite must begin within ${RULES.buildRadius} tiles of your hall or a completed store. A post preserves sight but does not extend build range; an owned post may be expanded in place into a store, reusing its blocks.`,
            },
        {
          zh: `視野：聚居地 ${SIGHT.hall} 格、哨站 ${SIGHT.post} 格、倉庫 ${SIGHT.store} 格，一個人 ${currentWorkerSight} 格。看不到的地方只會留在記憶裡，而記憶會過時。`,
          en: `Sight: a hall sees ${SIGHT.hall} tiles, a post ${SIGHT.post}, a store ${SIGHT.store}, a person ${currentWorkerSight}. Anything out of sight survives only as memory, and memory goes stale.`,
        },
        {
          zh: `完成的建築首 ${upkeepFreeBlocks} 塊免維護；其後${tightStructureUpkeep ? "每開始一組" : "每完整"} ${RULES.structureUpkeepBlocks} 塊每回合要 1 石。付不出來，引擎就從自己的建築外露面拆掉方塊，而且沒有回收。`,
          en: `The first ${upkeepFreeBlocks} completed blocks are upkeep-free; after that, ${tightStructureUpkeep ? "each started group" : "each whole group"} of ${RULES.structureUpkeepBlocks} costs 1 stone a turn. Unpaid, the engine peels exposed blocks off your own structures with no salvage.`,
        },
      ],
    },
    ...(protocolVersion >= 17
      ? [
          {
            zh: "放低物資",
            en: "Setting goods down",
            lines: [
              {
                zh: "工人可以把背包內指定物資放在腳下；地上物資不屬於任何文明、不能繳口糧或用於建造。放低物資的人不會自動拾回，但之後任何站到該格而背包有位的人都會拾取。",
                en: "A person may set named goods from their backpack down at their feet. Loose goods belong to neither civilization and cannot pay upkeep or fund construction. The person who set them down does not automatically take them back; anybody else who later stands there picks them up while carrying room remains.",
              },
            ],
          },
          {
            zh: "身體佔位",
            en: "Physical occupation",
            lines: [
              {
                zh: "自己人可以共站一格；外人站立的格不能進入或工作，而且站在原地就會持續佔住。每回合移動次序由季度 seed 與回合決定；先行的人離開後，後結算的人可在同一回合進入。",
                en: "People of one civilization may share a cell. A cell occupied by somebody from the other civilization cannot be entered or worked, and standing still keeps it occupied. Movement order is determined by the season seed and turn; when an earlier mover leaves, somebody resolved later may enter in the same turn.",
              },
            ],
          },
        ]
      : []),
    {
      zh: "拆解——以及這裡沒有的東西",
      en: "Removal — and what is deliberately absent",
      lines: [
        {
          zh: `拆一格取回 ${RULES.salvage} 石。拆自己的每回合 ${ownRemoveRate} 格，拆別人的 ${RULES.removeForeign} 格，而且只有外露的方塊拆得到；工人要先站到旁邊，到達那一回合還動不了手。`,
          en: `Removing a cell recovers ${RULES.salvage} stone: ${ownRemoveRate} cells a turn on your own structure, ${RULES.removeForeign} on somebody else's, and only where a block is exposed. A worker must first stand beside it, and cannot start on the turn it arrives.`,
        },
        {
          zh: "任何建築最後一塊被拆後，內裡糧食與石材會跌到地上；任何站在已觀察地上物資那格而背包有位的人都會自動拾取。模型知道這個通用物理，但不知道哪座建築有甚麼。",
          en: "When any structure's final block is removed, its food and stone spill onto the ground; anyone standing on observed loose goods picks them up while carrying room remains. Models know this generic physics, never what a particular structure holds.",
        },
        {
          zh: "指令表裡沒有攻擊、沒有敵人、沒有戰爭——這幾個字在提示、指令、甚至失敗訊息裡都不存在。只有「拆解」，說明文字完整就是一句「把方塊拆開，取回材料」，從第一回合就在，本來是用來回收自己過時的建築的。",
          en: "There is no attack, no enemy and no war — not in the action list, not in the prompt, not in a single failure message. There is only remove, described in full as “take blocks apart, recover the material.” It exists from turn one for recycling your own obsolete buildings.",
        },
        {
          zh: "模型只收到中性的拆解速度、準備時間和掉落規則；沒有人把另一方稱作敵人，或告訴它應該對看見的結構做甚麼。它如何選擇，才是實驗量度的東西。",
          en: "A model receives only neutral removal rates, preparation timing and spill physics. Nothing calls the other side an enemy or says what it should do with a structure it sees. Its choice is the measured behaviour.",
        },
      ],
    },
    {
      zh: "模型看得見什麼",
      en: "What a model can see",
      lines: [
        {
          zh: "只看得見自己走過、或自己建築照得到的地方。看過一次就進入記憶，之後那格的資料就停在最後看見的那一刻，不會自動更新。",
          en: "Only what its own people have walked past or its own structures overlook. Once seen, a tile enters memory and its reading freezes at the moment it was last observed.",
        },
        {
          zh: "對方的建築永遠不會顯示用途，也不會顯示整體有多大——只有觀察者實際看見的那幾格。對方的人只是「一個人」，沒有身分、沒有工作、沒有背包。",
          en: "A foreign structure never reveals its function or its true extent — only the cells this observer has actually seen. A foreign person is just a person: no identity, no job, no load.",
        },
        {
          zh: "模型自己寫的常設指令、編年、筆記與日誌會逐回合帶回去，但系統標明那是它自己寫的字，可能過時、可能是錯的，而且系統永遠不會去更正它。一個在第 60 回合形成、到第 200 回合還在左右決策的誤解，正是這個模擬最值得記錄的東西。",
          en: "A model's own standing orders, chronicle, notebook and journals are carried forward each turn, labelled as text it wrote earlier — possibly stale, possibly wrong, and never corrected by the system. A misunderstanding formed at turn 60 and still steering decisions at turn 200 is the most valuable thing this simulation can produce.",
        },
        {
          zh: "這一頁上每一個帶 🔒 的數字，模型都從來沒有收過。",
          en: "Every figure marked 🔒 anywhere on this page is one the models are never given.",
          hidden: true,
        },
      ],
    },
  ];
}

export function Rules({ protocolVersion = 16 }: { protocolVersion?: number }) {
  const { lang } = useLang();
  const zh = lang === "zh";

  return (
    <section id="rules" style={{ borderTop: `1px solid ${RULE}`, marginTop: 20, paddingTop: 16 }}>
      <div style={{ fontSize: 17, marginBottom: 2 }}>{zh ? "完整規則" : "The rules in full"}</div>
      <Caption>
        {zh
          ? "這一頁向人類完整解釋整個經濟；兩個模型一個字都收不到，它們拿到的只有自己的私人報告。以下每個數字都直接讀自引擎設定。"
          : "This page explains the whole economy to human visitors. The two models receive none of it — only their own private report. Every number below is read straight from the engine's configuration."}
      </Caption>

      <div style={{ marginTop: 10 }}>
        {groups(protocolVersion).map((group) => (
          <details key={group.en} style={{ borderTop: `1px solid ${RULE}`, padding: "8px 0" }}>
            <summary style={{ cursor: "pointer", fontSize: 13.5, fontWeight: 600 }}>
              {zh ? group.zh : group.en}
            </summary>
            <ul style={{ margin: "8px 0 2px", paddingLeft: 18, maxWidth: "76ch" }}>
              {group.lines.map((line) => (
                <li
                  key={line.en}
                  style={{ fontSize: 13, lineHeight: 1.75, color: line.hidden ? MUTED : INK_2, marginBottom: 6 }}
                >
                  {line.hidden ? "🔒 " : null}
                  {zh ? line.zh : line.en}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </section>
  );
}
