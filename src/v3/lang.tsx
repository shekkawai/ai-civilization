import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { RULES } from "../sim/config";

/**
 * v3 carries its own dictionary rather than reusing the old page's, so a label can be written for
 * this layout instead of inherited from another one. Two rules the design depends on:
 * labels sit above numbers (Chinese runs ~40% narrower than English, so nothing may size itself
 * to its text), and any sentence with numbers in it is a template with slots — never concatenation,
 * or the English reads like a robot.
 */

export type Lang = "zh" | "en";

const DICT = {
  title: { zh: "AI 文明觀察站", en: "AI Civilization" },
  believes: { zh: "所信", en: "believes" },
  truth: { zh: "事實", en: "Truth" },
  north: { zh: "北岸", en: "North Bank" },
  south: { zh: "南原", en: "South Plain" },
  turn: { zh: "回合", en: "Turn" },
  seat: { zh: "座位", en: "Seat" },
  nextTurn: { zh: "下一回合", en: "Next turn" },
  paused: { zh: "已暫停", en: "Paused" },
  finished: { zh: "已結束", en: "Finished" },
  live: { zh: "進行中", en: "Live" },
  jumpToNow: { zh: "跳到最新", en: "Jump to now" },
  gap: { zh: "兩方距離", en: "Gap" },
  tiles: { zh: "格", en: "tiles" },
  contact: { zh: "已接觸", en: "In contact" },
  noContact: { zh: "未接觸", en: "No contact" },
  seen: { zh: "已見過的地", en: "Tiles ever seen" },
  workers: { zh: "工人", en: "Workers" },
  food: { zh: "糧食", en: "Food" },
  stone: { zh: "石材", en: "Stone" },
  showTruth: { zh: "疊上事實", en: "Outline truth" },
  showIntent: { zh: "意圖線", en: "Intent lines" },
  loading: { zh: "載入中…", en: "Loading…" },
  noSeason: { zh: "沒有可顯示的季度。", en: "No season to show." },
  turnMissing: { zh: "這個回合沒有記錄。", en: "No record for this turn." },
  landmark: {
    complete: { zh: "首座建築完成", en: "First structure completed" },
    migration: { zh: "首名成年人加入", en: "First adult joined" },
    contact: { zh: "首次見到對方", en: "First sighting" },
    starve: { zh: "首次餓死", en: "First starvation" },
    removal: { zh: "首次拆解", en: "First removal" },
    message: { zh: "首次傳話", en: "First message" },
  },
  modelSays: { zh: "模型怎麼說", en: "What the model said" },
  whatHappened: { zh: "本回合發生", en: "What happened" },
  chartPopulation: { zh: "人口", en: "Population" },
  chartFood: { zh: "存糧", en: "Stored food" },
  chartFoodNote: {
    zh: "舊協定季度的點線＝當時下一人加入所需的糧食；v24 不再用這個門檻",
    en: "For older protocols, the dotted line is the former food threshold; v24 no longer uses it",
  },
  chartSeen: { zh: "已見過的地", en: "Tiles ever seen" },
  chartQuarry: { zh: "家門礦場尚餘", en: "Stone left in the home quarry" },
  chartQuarryNote: {
    zh: "石礦不會長回來，所以這條線只會往下。它碰到零的那一刻，就是「還想要石材就必須走出去」的那一刻。",
    en: "Stone never regrows, so this line only falls. The turn it reaches zero is the turn more stone means walking out for it.",
  },
  chartGap: { zh: "兩方最近工人距離", en: "Distance between nearest workers" },
  chartStone: { zh: "存石", en: "Stored stone" },
  chartHarvest: { zh: "本回合採集", en: "Harvested this turn" },
  chartHarvestNote: {
    zh: "糧食與石材合計，直接來自結果紀錄",
    en: "Food and stone together, straight from the results ledger",
  },
  chartBlocks: { zh: "已建方塊", en: "Blocks standing" },
  chartGapNote: {
    zh: "平線＝兩方從未靠近",
    en: "A flat line means the two sides never approached each other",
  },
  loom: { zh: "工人織圖 — 每人一行，橫跨整季", en: "Worker Loom — one lane per worker, across the season" },
  job_idle: { zh: "閒置", en: "idle" },
  job_move: { zh: "移動", en: "walking" },
  job_gather: { zh: "採集", en: "gathering" },
  job_deposit: { zh: "卸貨", en: "depositing" },
  job_build: { zh: "建造", en: "building" },
  job_repair: { zh: "修補", en: "repairing" },
  job_remove: { zh: "拆解", en: "removing" },
  turnSpine: { zh: "這一回合的次序", en: "This turn, in engine order" },
  stage_upkeep: { zh: "上繳糧食", en: "Upkeep" },
  stage_sighting: { zh: "看見對方", en: "Sighting" },
  stage_orders: { zh: "下達指令", en: "Orders" },
  stage_gathering: { zh: "採集", en: "Gathering" },
  stage_carrying: { zh: "搬運與存放", en: "Carrying" },
  stage_construction: { zh: "建造", en: "Construction" },
  stage_removalRepair: { zh: "拆解與修補", en: "Removal & repair" },
  stage_migrationCheck: { zh: "人口檢查", en: "Migration check" },
  refusals: { zh: "要求了但沒有做到", en: "Asked for and did not get" },
  noRefusals: { zh: "本回合沒有被拒絕的指令。", en: "Nothing was refused this turn." },
  gateTitle: { zh: "孩子長大成人的條件", en: "Gates for a child to come of age" },
  gateEvenTurn: { zh: `每 ${RULES.migrationInterval} 回合的檢查`, en: `The ${RULES.migrationInterval}-turn check` },
  gateRoom: { zh: "有位置", en: "A place is free" },
  gateFood: { zh: "連續交足口糧", en: "Fully-fed streak" },
  gateStoredFood: { zh: "存糧達到加入門檻", en: "Joining food is stored" },
  gateGround: { zh: "聚居地旁有空地", en: "Open ground beside the settlement" },
  gateJoined: { zh: "一個孩子長大成人加入了", en: "A child came of age" },
  gateNobody: { zh: "沒有人加入", en: "Nobody joined" },
  stores: { zh: "存放", en: "Stores" },
  stored: { zh: "已入庫", en: "stored" },
  inBackpacks: { zh: "在背包", en: "in backpacks" },
  capacity: { zh: "容量", en: "capacity" },
  upkeepTick: { zh: "下回合上繳", en: "next upkeep" },
  joinTick: { zh: "加入門檻", en: "join threshold" },
  onTheGround: { zh: "散落在地上", en: "On the ground" },
  groundNote: { zh: "無人擁有，要有人走過去撿", en: "owned by nobody; somebody has to walk there" },
  wouldOverflow: { zh: "背包裡的東西已放不進倉庫", en: "the backpacks no longer fit in storage" },
  sinceThen: { zh: "之後：", en: "Since then:" },
  more: { zh: "更多", en: "More" },
  less: { zh: "收起", en: "Less" },
  hiddenFromModels: {
    zh: "模型看不到這個數字",
    en: "The models are never told this number",
  },

  // ---------------------------------------------------------------- the explanation layer
  premise: {
    zh: "兩個文明住在同一張地圖上，地形、資源與距離完全相同——地圖轉 180° 之後跟原本一模一樣。每 {hours} 小時一個回合，兩邊同時作決定，然後規則一次過結算。沒有勝利條件，也沒有回合上限：一方的工人全部死去，這一季就結束。每一方只知道自己親眼看過的地方；切換北岸、南原與事實，可以比較同一個世界的三個版本——這個落差正是實驗要看的東西。",
    en: "Two civilizations share one map whose terrain, resources and distances are identical — rotate it 180° and it is itself. A turn passes every {hours} hours: both sides decide at the same moment, then the rules resolve once. There is no victory condition and no turn limit; a season ends when one side has no living workers. Each side knows only what its own people have seen. Switch between North, South and Truth to compare three versions of the same world — that mismatch is the experiment.",
  },
  teach: { zh: "教我", en: "Explain" },
  ruleOpen: { zh: "這個數字怎麼來的", en: "Where this number comes from" },
  lockNote: {
    // Not "they are never told the regrowth rate" — since v22 the private report prints every
    // observed cell's own rate and cap, which is precisely why the map may draw the distinction
    // too. What stays hidden is the unobserved world and anything about the other side.
    zh: "🔒 標示的數字，模型從來不會看到——牠們不知道自己一共見過多少地，也不知道對方有多少人、多少存糧。牠們親眼見過的每一格，倒是連再生速度和上限都照實收到。",
    en: "🔒 marks a figure the models are never given — how much of the map they have seen in total, and anything at all about the other side's people or stores. For a cell they have actually looked at they do receive its own regrowth rate and cap.",
  },

  // Section captions: what you are looking at, and what would be worth noticing.
  capMaps: {
    zh: "這是同一張地圖的三個視角；用上方按鈕切換北岸所信、南原所信與事實。滿色是這一刻看得見的，淺色是記憶（愈舊愈淡），空白是從未見過。點任何一格或任何一個人，下面會展開紀錄。",
    en: "One map, seen through three lenses. Use the buttons above to switch between North's belief, South's belief and Truth. Full colour is visible now, pale is memory (older means fainter), and blank is never seen. Click any tile or person to open its record below.",
  },
  capStores: {
    zh: "這條把各座實體倉存的數字加總，方便比較；倉庫本身並不隔空共享。每座建築內，糧食與石材共用本地倉位。實色是已入庫，斜紋是還在工人背包裡——背包裡的糧食不能吃。斜紋長而實色不動，就是物流斷了。",
    en: "This bar aggregates every physical storage structure for comparison; the buildings do not share goods remotely. Inside each building, food and stone compete for its local space. Solid is stored, hatched is still in backpacks — and backpack food cannot be eaten. A growing hatch beside a flat solid is a supply chain that has stopped.",
  },
  capSpine: {
    zh: "引擎每一回合都用同一個次序結算，所以這裡永遠是同樣九行，沒有發生的那行會變淡。被拒絕的指令和成功的指令並排放：同一個拒絕連續出現多回合，通常比任何成功更能說明問題。",
    en: "The engine resolves every turn in the same order, so these rows never change places and an empty stage simply greys out. Refusals sit beside successes on purpose: the same refusal repeating for many turns usually says more than any success.",
  },
  capLoom: {
    zh: "每個工人一行，橫跨整季，顏色是他那個回合在做什麼。一整片綠而沒有黃色，代表一直在採集卻沒有入倉。點任何一格可以跳到那個回合並選中那個人。",
    en: "One lane per worker across the whole season, coloured by what it was doing. A wall of green with no yellow means gathering that never became a deposit. Click any cell to jump to that turn with that worker selected.",
  },
  capCharts: {
    zh: "所有圖共用同一條回合軸，播放頭同時穿過全部圖。北岸實線，南原虛線，全站一致。點圖上任何位置可以跳到那個回合。",
    en: "Every chart shares one turn axis and the playhead runs through all of them at once. North is solid, south is dashed, everywhere on the site. Click anywhere on a chart to scrub to that turn.",
  },
  capJournals: {
    zh: "左邊是模型自己說牠在做什麼，右邊是引擎實際做了什麼。兩者刻意分開排版：模型可以寫「派三人去採石」而指令其實把人送去了農地，這種落差本身就是觀察結果。",
    en: "What the model said it was doing, beside what the engine actually did. They are kept visually apart on purpose: a model can write \"three sent to the quarry\" while its orders sent them to a field, and that mismatch is itself a finding.",
  },
  capGates: {
    zh: "加人不是文明可以要求的動作，而是規則自動檢查的四個條件。看着它失敗，比讀規則有用。",
    en: "An adult joining is not an action a civilization can request — it is four conditions the rules test automatically. Watching one fail teaches the rule faster than reading it.",
  },

  // Map legend.
  legField: { zh: "農地", en: "Field" },
  legOasis: { zh: "綠洲（四格共用一份糧）", en: "Oasis (four cells share one food pool)" },
  legStoneGround: { zh: "石地", en: "Stone ground" },
  legWater: { zh: "水", en: "Water" },
  legRidge: { zh: "山脊", en: "Ridge" },
  legFood: { zh: "會再生的糧食（圓）", en: "Food that regrows (circle)" },
  legFoodPlain: { zh: "糧食（圓）", en: "Food (circle)" },
  legFoodFinite: { zh: "不會再生的糧食（方）", en: "Food that never regrows (square)" },
  legStone: { zh: "石材（菱形，永不再生）", en: "Stone (diamond, never regrows)" },
  legNode: {
    zh: "地本身亦會跟著褪色，所以整片田或整座礦剩多少，遠看就見到。四級比的是那一格自己的上限，不是固定數字——糧田和石礦的滿量差很遠。點一格可看實際數量。",
    en: "The ground itself fades with the mark, so how much a whole field belt or quarry has left is readable from a distance. The four steps are fractions of that tile's own capacity, not a fixed number — a full field and a full quarry are nothing alike. Click a tile for the actual amount.",
  },
  legShape: {
    // Only rendered on a map that actually has both kinds of food, so it can afford to be blunt
    // about what the difference costs.
    zh: "圓形代表會長回來，有角代表不會。這張地圖的糧食有兩種：方形那些採完就永遠沒有了，圓形那些才是可以長住的地方。",
    en: "Round means it comes back; angular means it does not. This map has both kinds of food: a square is a larder that ends when it is worked out, and only a circle can be lived beside.",
  },
  legBlockNorth: { zh: "北岸的方塊", en: "North Bank block" },
  legBlockSouth: { zh: "南原的方塊", en: "South Plain block" },
  legWorkerOwn: { zh: "自己的工人", en: "Own worker" },
  legWorkerSeen: { zh: "此刻看見的陌生人（不知是誰）", en: "A stranger being watched right now (identity unknown)" },
  legLoad: { zh: "外圈＝背包裝了多少（綠糧食、灰石材）", en: "Outer ring: how full the pack is (green food, grey stone)" },
  legStalled: { zh: "中間空心＝這回合沒有工作，或工作走不下去", en: "Hollow centre: no job this turn, or a job that cannot proceed" },
  legLoadNote: {
    zh: "這個世界裡的東西要親手搬進倉庫才算數，所以背包滿的人其實是在還沒入帳的路上。空心的人則是這一回合完全沒有產出——閒置久了通常代表模型忘了他。",
    en: "Nothing in this world counts until it is physically inside a store, so a full pack is a load that has not been banked yet. A hollow mark is a turn that produced nothing — a long run of them usually means the model has forgotten that person.",
  },
  legVisible: { zh: "目前視野（實線邊界）", en: "Visible now (solid boundary)" },
  legMemory: { zh: "過去看過（斜線；愈舊愈淡）", en: "Seen before (hatched; older is fainter)" },
  legUnseen: { zh: "從未見過（留白）", en: "Never seen (blank paper)" },
  legOutline: { zh: "存在但這一方不知道", en: "Exists, but this side does not know" },
  legIntent: { zh: "意圖線：工人正前往的目標", en: "Intent line: where a worker's job is taking it" },
  legStack: { zh: "×N：同一格上有 N 個人", en: "×N: that many people standing on one tile" },
  legRoute: {
    zh: "所選工人的來回路線：實線是現在正在走的一段，虛線是之後的回程",
    en: "The selected worker's round trip: solid is the leg being walked now, dashed is the return that follows",
  },

  // Home ceilings.
  ceilTitle: { zh: "這張地圖的家門口容得下多少人", en: "What this map allows at home" },
  ceilFood: { zh: "糧食上限", en: "Food ceiling" },
  ceilLarder: { zh: "家門口的糧倉底", en: "The larder at home" },
  ceilBindNoIncome: {
    zh: "家門口沒有任何糧食收入：不是養不起多少人的問題，而是不搬走就一定會餓死。",
    en: "Home has no food income at all. The question is not how many it feeds — it is that staying is fatal.",
  },
  ceilStone: { zh: "石材上限", en: "Stone ceiling" },
  ceilStoneBuys: { zh: "家門石材買得起", en: "What home stone buys" },
  ceilNext: { zh: "下一批石材有多遠", en: "Distance to the next stone" },
  ceilSymmetric: {
    zh: "兩邊的稟賦完全相同（地圖是 180° 鏡像），所以任何差異都是決策造成的。",
    en: "Both sides are endowed identically — the map is a 180° mirror — so any difference is a decision.",
  },
  ceilAsymmetric: {
    zh: "兩邊的稟賦這一季並不相同。",
    en: "The two sides are not endowed identically this season.",
  },
  ceilBindStone: { zh: "先撞到的是石材：位置不夠，不是糧食不夠。", en: "Stone binds first: they run out of places, not food." },
  ceilBindFood: { zh: "先撞到的是糧食：養不起，不是住不下。", en: "Food binds first: they run out of food, not places." },
  ceilBindBoth: { zh: "兩個上限差不多同時到達。", en: "The two ceilings arrive at about the same time." },

  // Landmarks and the playhead.
  landmarksTitle: { zh: "轉捩點", en: "Landmarks" },
  originalText: { zh: "引擎原文", en: "engine's original wording" },
  ofTiles: { zh: "格", en: "tiles" },
} as const;

type Key = keyof typeof DICT;

const LangContext = createContext<{ lang: Lang; setLang: (lang: Lang) => void }>({
  lang: "zh",
  setLang: () => {},
});

export function V3LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() =>
    typeof navigator !== "undefined" && navigator.language.startsWith("en") ? "en" : "zh",
  );
  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = lang === "zh" ? "zh-Hant" : "en";
  }, [lang]);
  const value = useMemo(() => ({ lang, setLang }), [lang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

/**
 * A sentence with numbers in it is a template with slots, never concatenation. Gluing fragments
 * together works in Chinese and produces "North Bankbelieves" in English, and the two languages put
 * their numbers in different places.
 */
function translate(key: Key, lang: Lang, values?: Record<string, string | number>): string {
  const entry = DICT[key];
  const text = typeof entry === "object" && "zh" in entry ? entry[lang] : String(key);
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

function landmarkLabel(kind: string, lang: Lang): string {
  const entry = DICT.landmark[kind as keyof typeof DICT.landmark];
  return entry ? entry[lang] : kind;
}

/**
 * The helpers are module-level and the hook only binds them to the current language. Declaring
 * them as function statements inside the hook makes the React Compiler emit a memo branch that
 * caches the function but never assigns it, so the second helper arrives undefined on first render.
 */
export function useLang() {
  const { lang, setLang } = useContext(LangContext);
  return useMemo(
    () => ({
      lang,
      setLang,
      t: (key: Key, values?: Record<string, string | number>) => translate(key, lang, values),
      landmark: (kind: string) => landmarkLabel(kind, lang),
    }),
    [lang, setLang],
  );
}

/** Civilization label, so the belief switch and the map headers never drift apart. */
export function civLabel(civ: "north" | "south", lang: Lang) {
  if (civ === "north") return lang === "zh" ? "北岸" : "North Bank";
  return lang === "zh" ? "南原" : "South Plain";
}

/**
 * "北岸所信" / "North Bank believes" — a template per language, because gluing a label to a word
 * works in Chinese and produces "North Bankbelieves" in English.
 */
export function believesLabel(civ: "north" | "south", lang: Lang) {
  return lang === "zh" ? `${civLabel(civ, lang)}所信` : `${civLabel(civ, lang)} believes`;
}
