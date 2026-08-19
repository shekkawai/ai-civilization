import { useEffect, useState } from "react";
import { CIV_COLOUR } from "./BeliefMap";
import { Note } from "./RuleNote";
import { civLabel, useLang, type Lang } from "./lang";
import { useNarrow } from "./responsive";
import { RULES } from "../sim/config";
import type { CivId } from "../sim/types";

/**
 * Did this model use its people well?
 *
 * Every other surface on the page reports what a civilization **has** — food, stone, tiles seen.
 * None of them says what a turn of somebody's labour was worth, which is the question a viewer
 * actually asks when watching two models run the same map: is one of them planning, and is the
 * other one walking half-empty backpacks around?
 *
 * The six readings here were chosen by measuring every recorded season rather than guessed at.
 * What that measurement found, and why each one survived:
 *
 * - **Delivered per worker-turn** is the headline because it integrates all the others. Walking,
 *   idling, small loads and refused orders all reduce it, and it counts only goods that physically
 *   reached storage — a backpack is not a granary. Across the five longest seasons the side with
 *   the higher figure also had the lower idle share and the bigger loads, every time.
 * - **Load per trip needs turns per trip beside it, or it lies.** A five-unit delivery from a field
 *   next to the store is optimal; the same delivery after a four-turn walk is waste. v11 is the case
 *   that settles it: both sides ran a ~3.5-turn delivery cycle and one brought back 4.4 while the
 *   other brought 9.9. Same walk, more than double the payload.
 * - **Refused orders** is one of the two ways a turn buys nothing: an order the rules would not
 *   carry out. The other way — a genuinely idle turn — is not a table row any more, because a
 *   single percentage kept restating what the Logistics cards already said while answering
 *   nothing. It lives below as an attribution block instead: every genuinely idle worker-turn is
 *   either the ordinary gap between jobs, an order the rules refused, or neglect (a second
 *   consecutive idle turn the model said nothing about) — which is the answer to the one question
 *   a viewer actually asks about idle people: did the model choose this?
 * - **Tiles per worker-turn** measures exploration as return on labour rather than as a total, which
 *   is the only way to compare a side that spent more people on it.
 * - **Still in backpacks** is context, not a score. It is the gap between what came off the map and
 *   what reached storage, and a large one says the supply chain is the constraint.
 * - **The crisis record** replaces the obvious-but-wrong reading, a death count. The engine kills
 *   exactly one worker per hungry turn and picks the victim itself, so a death is never something
 *   a model decided; what is the model's is the response to warning. Every recorded death came
 *   after at least three straight turns of cover below three turns of upkeep, and eight
 *   civ-seasons entered that band and saved everyone — so the record states warnings, rescues,
 *   deaths, and what the dead were carrying, which separates "starved holding the cure in
 *   backpacks" from "the food never existed".
 *
 * **There is no composite and no ranking, deliberately.** The rules define no victory condition, and
 * a season is a single run — the honest thing a viewer can take from this is which side used its
 * labour better on this map, per reading, not which model is better. The comparison is meaningful at
 * all only because the map is 180°-symmetric, so both sides face the same distances.
 *
 * None of this may ever reach a player.
 */

const RULE = "#ded5c4";
const MUTED = "#8a8172";
const INK_2 = "#55524a";

interface Row {
  civ: CivId;
  worker_turns: number;
  idle_turns: number;
  idle_gap: number;
  idle_refused: number;
  idle_neglect: number;
  delivered: number;
  trips: number;
  load_per_trip: number | null;
  turns_per_trip: number | null;
  issued: number;
  refused: number;
  seen_tiles: number | null;
  carried: number | null;
  workers: number | null;
  deaths: number;
  spilled_food: number;
  spilled_stone: number;
  warn_episodes: number;
  rescued_episodes: number;
  ongoing_episode: number;
}

/** A reading, its two values, and which direction is better. `higher` may be undefined: 背包裡的存貨 has no good direction. */
interface Reading {
  key: string;
  label: string;
  note: string;
  value: (row: Row) => number | null;
  print: (value: number) => string;
  higher?: boolean;
}

export function Efficiency({ seasonId, turn }: { seasonId: string; turn: number }) {
  const { lang } = useLang();
  const narrow = useNarrow();
  const zh = lang === "zh";
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/research/efficiency?seasonId=${encodeURIComponent(seasonId)}&turn=${turn}`, {
      headers: { Accept: "application/json" },
    })
      .then((response) => (response.ok ? response.json() : []))
      .then((data) => {
        if (!cancelled) setRows(data as Row[]);
      });
    return () => {
      cancelled = true;
    };
  }, [seasonId, turn]);

  if (!rows || rows.length < 2) return null;
  const north = rows.find((row) => row.civ === "north");
  const south = rows.find((row) => row.civ === "south");
  if (!north || !south) return null;

  const readings: Reading[] = [
    {
      key: "delivered",
      label: zh ? "每個工人回合，運進倉裡多少" : "delivered into storage per worker-turn",
      note: zh
        ? "總入倉量 ÷ 所有工人回合。走路、閒置、空手來回、被拒的指令，全部都會拉低這個數。背包裡的不算——要真的走到倉才算。"
        : "Total goods that reached storage ÷ every worker-turn spent. Walking, idling, half-empty trips and refused orders all pull it down. Goods in a backpack do not count; they have to physically arrive.",
      value: (row) => (row.worker_turns > 0 ? row.delivered / row.worker_turns : null),
      print: (value) => value.toFixed(2),
      higher: true,
    },
    {
      key: "load",
      label: zh ? "每趟運回多少（背包 30 格）" : `goods per delivery (a pack holds ${RULES.carry})`,
      note: zh
        ? "一個工人走回倉那一趟，實際交出多少。要跟下一行一起看：如果田就在倉旁邊，每次只交 5 也完全合理。"
        : "What one worker actually handed over on one trip. Read it with the next row: if the field is beside the store, handing over 5 every turn is perfectly sensible.",
      value: (row) => row.load_per_trip,
      print: (value) => `${value.toFixed(1)}　(${Math.round((value / RULES.carry) * 100)}%)`,
      higher: true,
    },
    {
      key: "cycle",
      label: zh ? "每趟隔幾個回合" : "turns between one worker's deliveries",
      note: zh
        ? "同一個工人兩次交貨之間隔了多久，即是一趟來回的成本。兩邊的回合數差不多、但每趟運回量差一倍，就是計劃能力的差別，不是距離的差別。"
        : "How long between the same worker's deliveries — the cost of one round trip. When both sides run a similar cycle but one brings back twice as much, that is a planning difference, not a distance one.",
      value: (row) => row.turns_per_trip,
      print: (value) => value.toFixed(1),
      higher: false,
    },
    {
      key: "refused",
      label: zh ? "被規則拒絕的指令" : "orders the rules would not carry out",
      note: zh
        ? "下了但做不到的指令佔比——走不到、地方不夠、時機不對。高代表這個模型對規則的理解跟世界對不上。"
        : "Issued orders that failed or were rejected — unreachable, not enough room, wrong moment. A high rate means the model's picture of the rules does not match the world.",
      value: (row) => (row.issued > 0 ? (100 * row.refused) / row.issued : null),
      print: (value) => `${value.toFixed(1)}%`,
      higher: false,
    },
    {
      key: "seen",
      label: zh ? "每個工人回合看到多少地 🔒" : "tiles ever seen per worker-turn 🔒",
      note: zh
        ? "探索當成人力回報來計，而不是看總數。派多幾個人出去當然看得多，這一行問的是每一份人力換到多少。"
        : "Exploration as return on labour rather than as a total. Sending more people out sees more ground; this asks what each unit of labour bought.",
      value: (row) => (row.worker_turns > 0 && row.seen_tiles ? row.seen_tiles / row.worker_turns : null),
      print: (value) => value.toFixed(2),
      higher: true,
    },
    {
      key: "carried",
      label: zh ? "此刻還在背包裡" : "still sitting in backpacks",
      note: zh
        ? "採到手但未入倉的量。沒有好壞之分：數字大代表卡住的是運輸，不是採集。"
        : "Gathered but not yet delivered. Neither good nor bad: a large figure says the bottleneck is haulage, not gathering.",
      value: (row) => row.carried,
      print: (value) => `${Math.round(value)}`,
    },
  ];

  return (
    <section style={{ borderTop: `1px solid ${RULE}`, marginTop: 20, paddingTop: 16 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: MUTED, textTransform: "uppercase" }}>
        {zh ? "人力用得好不好" : "how well the labour was used"}
      </div>
      <p style={{ margin: "8px 0 4px", fontSize: 12.5, lineHeight: 1.7, color: INK_2, maxWidth: "80ch" }}>
        {zh
          ? `累計到第 ${turn} 回合。地圖轉 180° 完全對稱，兩邊的距離和資源一模一樣，所以這些數字可以直接並排比較。`
          : `Cumulative through turn ${turn}. The map is 180°-symmetric, so both sides face identical distances and resources and these figures compare directly.`}
      </p>

      {narrow ? (
        // A 560px table on a 390px screen scrolls sideways, and a reader who does not discover that
        // sees only the first civilization — on the one section built to compare two. Each reading
        // becomes its own block instead, with the pair drawn as two bars on a shared scale so the
        // comparison survives at any width.
        <div style={{ marginTop: 6 }}>
          {readings.map((reading) => (
            <ReadingCard key={reading.key} reading={reading} north={north} south={south} zh={zh} lang={lang} />
          ))}
        </div>
      ) : (
        // Full width on a wide screen strands each value 300px from its own label, which is the one
        // thing a comparison table must not do.
        <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%", maxWidth: 880 }}>
          <thead>
            <tr>
              <th style={{ ...head, textAlign: "left" }} />
              <th style={{ ...head, color: CIV_COLOUR.north }}>{civLabel("north", lang)}</th>
              <th style={{ ...head, color: CIV_COLOUR.south }}>{civLabel("south", lang)}</th>
              <th style={{ ...head, textAlign: "left", color: MUTED, fontWeight: 400 }}>
                {zh ? "差距" : "difference"}
              </th>
            </tr>
          </thead>
          <tbody>
            {readings.map((reading) => (
              <ReadingRow key={reading.key} reading={reading} north={north} south={south} zh={zh} />
            ))}
          </tbody>
        </table>
      )}

      <IdleSplit north={north} south={south} zh={zh} lang={lang} />
      <CrisisRecord north={north} south={south} zh={zh} lang={lang} />

      <Note label={zh ? "為什麼這裡沒有總分？" : "why is there no total score?"}>
        {zh
          ? "這裡不會給一個總分，也不會說哪一方贏——規則裡根本沒有勝利條件，而一季只是一次運行。能誠實講的是：在這張地圖上，哪一方每一份人力換到的東西比較多，以及差在哪一項。座位每季會對調，所以要判斷一個模型，要看幾季的同一項數字。"
          : "There is no total score and no winner here: the rules define no victory condition, and one season is a single run. What these figures can honestly say is which side got more out of each unit of labour on this map, and on which reading. Seats rotate between seasons, so judging a model means reading the same row across several of them."}
      </Note>
    </section>
  );
}

/** The three ways a genuinely idle worker-turn happens, coloured by responsibility. */
const IDLE_PART = {
  gap: { colour: "#cdc4b1", zh: "工作交接空窗", en: "gap between jobs" },
  refused: { colour: "#9c3c3c", zh: "指令被規則拒絕", en: "order refused by the rules" },
  neglect: { colour: "#55524a", zh: "模型連續未派工", en: "left unaddressed again" },
} as const;

/**
 * Was the idle the model's choice? One stacked bar per civilization.
 *
 * A stacked bar and not a table row, because this is the one reading that is parts of a whole:
 * the length is the civilization's genuinely-idle share of worker-turns, and the segments are who
 * owns it. Two bars on a shared scale keep the magnitude comparison the old percentage row gave,
 * while adding the only fact that percentage could not carry — the same 5% idle can be five
 * harmless job hand-offs or a model repeatedly saying nothing about a person standing still.
 *
 * The strict idle definition (no movement, no outcome, no standing job, not newly joined) is the
 * same one the Logistics band uses, and is explained there.
 */
function IdleSplit({ north, south, zh, lang }: { north: Row; south: Row; zh: boolean; lang: Lang }) {
  const share = (row: Row) => (row.worker_turns > 0 ? (100 * row.idle_turns) / row.worker_turns : 0);
  const peak = Math.max(share(north), share(south));
  const rows: Array<{ civ: CivId; row: Row }> = [
    { civ: "north", row: north },
    { civ: "south", row: south },
  ];
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.08em", color: MUTED, textTransform: "uppercase" }}>
        {zh ? "閒置是誰造成的？" : "who owns the idle turns?"}
      </div>
      <div style={{ margin: "8px 0 4px" }}>
        {rows.map(({ civ, row }) => (
          <div key={civ} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: 11, color: CIV_COLOUR[civ], width: 72, flex: "0 0 auto" }}>
              {civLabel(civ, lang)}
            </span>
            <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", width: 96, flex: "0 0 auto" }}>
              {share(row).toFixed(1)}%　({row.idle_turns})
            </span>
            <span style={{ flex: "1 1 0", minWidth: 0, height: 11, background: "#ece5d7", display: "flex" }}>
              {row.idle_turns > 0 && peak > 0 ? (
                <span
                  style={{
                    display: "flex",
                    width: `${Math.min(100, (share(row) / peak) * 100)}%`,
                    height: "100%",
                  }}
                >
                  {(["gap", "refused", "neglect"] as const).map((part) => (
                    <span
                      key={part}
                      style={{
                        display: "block",
                        height: "100%",
                        width: `${(100 * row[`idle_${part}`]) / row.idle_turns}%`,
                        background: IDLE_PART[part].colour,
                      }}
                    />
                  ))}
                </span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 14px", fontSize: 11, color: INK_2 }}>
        {(["gap", "refused", "neglect"] as const).map((part) => (
          <span key={part} style={{ whiteSpace: "nowrap" }}>
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                background: IDLE_PART[part].colour,
                border: "1px solid rgba(43,39,35,0.18)",
                marginRight: 5,
                verticalAlign: "-1px",
              }}
            />
            {zh ? IDLE_PART[part].zh : IDLE_PART[part].en}
            {"　"}
            <span style={{ color: MUTED, fontVariantNumeric: "tabular-nums" }}>
              {civLabel("north", lang)} {north[`idle_${part}`]} · {civLabel("south", lang)} {south[`idle_${part}`]}
            </span>
          </span>
        ))}
      </div>
      <Note>
        {zh
          ? "閒置採用與「資源與物流」相同的嚴格定義：沒有移動、沒有工作結果、沒有進行中的工作，也不是本回合新加入。工人做完一件事、等模型下個決策的那一回合是「交接空窗」；模型有下令但規則拒絕執行是「指令被拒」；只有工人已經閒了一回合、模型再次隻字不提，才算「連續未派工」。翻查全部已記錄的季度：連續未派工最多只佔一方 2.4% 的工人回合（v10 北岸）——模型幾乎總會在下一次決策回應閒置的工人，所以大量閒置通常反映的是交接習慣，不是遺忘。"
          : "Idle uses the same strict definition as the Logistics band: no movement, no job outcome, no standing job, not newly joined. A worker waiting one turn for the model's next decision after finishing something is a hand-off gap; an order the rules would not carry out is a refusal; only a worker already idle a full turn that the model again says nothing about counts as unaddressed. Across every recorded season that last kind never exceeded 2.4% of a side's worker-turns (v10 north) — models almost always answer an idle worker at the next decision, so a large idle share usually reflects hand-off habits, not forgetfulness."}
      </Note>
    </div>
  );
}

/**
 * Warnings, rescues, deaths, and what the dead were carrying — as numbers, not a chart.
 *
 * Deliberately not a death-count row in the table and not a time-series: the engine kills exactly
 * one worker per hungry turn and picks the victim itself, so a death is never a decision a model
 * made, and the trajectory that leads to one is already drawn in the Pressure section's runway.
 * What belongs to the model is the response to warning, and that is an episode count small enough
 * (0–10 a season) that a chart would dress three integers up as a trend. The spilled figure is the
 * one that separates failure species: food that existed but sat in backpacks against food that
 * never existed.
 */
function CrisisRecord({ north, south, zh, lang }: { north: Row; south: Row; zh: boolean; lang: Lang }) {
  const quiet =
    north.warn_episodes === 0 && south.warn_episodes === 0 && north.deaths === 0 && south.deaths === 0;
  const rows: Array<{ civ: CivId; row: Row }> = [
    { civ: "north", row: north },
    { civ: "south", row: south },
  ];
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.08em", color: MUTED, textTransform: "uppercase" }}>
        {zh ? "糧食危機紀錄" : "the food crisis record"}
      </div>
      {quiet ? (
        <p style={{ margin: "8px 0 0", fontSize: 12.5, color: INK_2 }}>
          {zh
            ? "到目前為止，兩邊的存糧都未跌入警戒區（不足 3 回合的維生糧）。"
            : "So far neither side's stored food has entered the danger band (under 3 turns of upkeep)."}
        </p>
      ) : (
        <div style={{ margin: "8px 0 0" }}>
          {rows.map(({ civ, row }) => (
            <div key={civ} style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 5 }}>
              <span style={{ fontSize: 11, color: CIV_COLOUR[civ], width: 72, flex: "0 0 auto" }}>
                {civLabel(civ, lang)}
              </span>
              <span style={{ fontSize: 13, color: INK_2, lineHeight: 1.6 }}>
                {zh ? (
                  <>
                    警戒 {row.warn_episodes} 次 · 救回 {row.rescued_episodes} 次 · 餓死{" "}
                    <span style={{ color: row.deaths > 0 ? "#9c3c3c" : undefined }}>{row.deaths} 人</span>
                    {row.ongoing_episode ? " · 現正處於警戒區" : ""}
                    {row.spilled_food > 0 ? ` · 死者背包裡還有 ${row.spilled_food} 糧食` : ""}
                  </>
                ) : (
                  <>
                    {row.warn_episodes} warning{row.warn_episodes === 1 ? "" : "s"} · {row.rescued_episodes} rescued ·{" "}
                    <span style={{ color: row.deaths > 0 ? "#9c3c3c" : undefined }}>
                      {row.deaths} starved
                    </span>
                    {row.ongoing_episode ? " · in the danger band now" : ""}
                    {row.spilled_food > 0 ? ` · the dead were carrying ${row.spilled_food} food` : ""}
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      <Note>
        {zh
          ? "一次「警戒」是存糧連續低於 3 回合維生量的一段時間；之後不是救回，就是餓死。餓死從來不是模型的決定——引擎每個飢餓回合固定帶走 1 人，人選也是引擎挑的；模型能控制的是警戒出現後的反應，所以這裡數的是反應，不是屍體。歷來每一次餓死之前，至少都有連續 3 回合的警戒可見；也有 8 個季度一方跌入警戒區後全員救回。「死者背包裡的糧食」是分水嶺：背包不能支付維生（只有倉庫可以），死時背包有糧代表糧食其實存在、只是從未入倉——這是規則理解問題，跟根本沒有糧食收入是兩種不同的失敗。即時的續航曲線在「壓力」一節，這裡只記結果。"
          : "One warning is a stretch of stored food below 3 turns of upkeep; it ends in a rescue or a death. Starving is never the model's decision — the engine takes exactly one person per hungry turn and picks who; what the model controls is its response once the warning shows, so this counts responses, not bodies. Every recorded death was preceded by at least 3 consecutive warning turns, and in 8 recorded civ-seasons a side entered the band and saved everyone. The spilled-food figure is the divide: backpacks cannot pay upkeep (only stores can), so dying with food on your back means the food existed and simply never reached a granary — a rules misunderstanding, which is a different failure from having no food income at all. The live runway curve is in the Pressure section; this is the ledger of outcomes."}
      </Note>
    </div>
  );
}

const head: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textAlign: "right",
  padding: "4px 14px 6px 0",
  borderBottom: `1px solid ${RULE}`,
  whiteSpace: "nowrap",
};

const cell: React.CSSProperties = {
  fontSize: 15,
  textAlign: "right",
  padding: "7px 14px 7px 0",
  whiteSpace: "nowrap",
};

/**
 * One reading, both sides, and the gap named in words.
 *
 * The gap is stated as a ratio or a difference in the reading's own units — never as a rank, a
 * medal or a colour that says "winner". Naming which side is ahead on one measurement is a fact;
 * declaring a side better is a story the rules do not support.
 */
function compare(reading: Reading, north: Row, south: Row, zh: boolean) {
  const left = reading.value(north);
  const right = reading.value(south);
  const known = left !== null && right !== null && Number.isFinite(left) && Number.isFinite(right);

  let gap = "—";
  let ahead: CivId | null = null;
  if (known && reading.higher !== undefined) {
    const big = Math.max(left!, right!);
    const small = Math.min(left!, right!);
    // A season is one run of two models. Calling a 3% gap a lead invites a reader to see a result
    // in noise — v11's two sides ran 3.4 and 3.5 turns between deliveries, which is the same
    // number. Below a tenth the row says so and names nobody.
    const level = small > 0 ? big / small < 1.1 : big < 1e-9;
    ahead = level ? null : (reading.higher ? left! > right! : left! < right!) ? "north" : "south";
    gap = level
      ? zh
        ? "大致相同"
        : "about level"
      : small > 0
        ? zh
          ? `相差 ${(big / small).toFixed(2)} 倍`
          : `${(big / small).toFixed(2)}×`
        : // A ratio against zero is infinite and says nothing. State the gap in the reading's own
          // units instead, which is what a reader can actually check against the two values.
          zh
          ? `相差 ${reading.print(big - small)}`
          : `${reading.print(big - small)} apart`;
  } else if (known) {
    gap = zh ? "不分好壞" : "no better direction";
  }
  return { left, right, known, gap, ahead };
}

/**
 * The gap in words, and which way is better.
 *
 * The direction has to be stated because the bars carry magnitude only: 8.9% idle draws a longer bar
 * than 3.7% idle, and on the one reading that is pure waste the longer bar is the worse one. Naming
 * "lower is better" beside it costs four words and removes the only way to read these backwards.
 */
function AheadNote({
  ahead,
  gap,
  zh,
  higher,
}: {
  ahead: CivId | null;
  gap: string;
  zh: boolean;
  higher?: boolean;
}) {
  return (
    <>
      {gap}
      {ahead ? (
        <span style={{ color: CIV_COLOUR[ahead] }}>
          {" · "}
          {zh ? `${ahead === "north" ? "北岸" : "南原"}較佳` : `${ahead === "north" ? "north" : "south"} ahead`}
        </span>
      ) : null}
      {higher === undefined ? null : (
        <span style={{ opacity: 0.75 }}>
          {" · "}
          {higher ? (zh ? "越高越好" : "higher is better") : zh ? "越低越好" : "lower is better"}
        </span>
      )}
    </>
  );
}

function ReadingRow({ reading, north, south, zh }: { reading: Reading; north: Row; south: Row; zh: boolean }) {
  const { left, right, known, gap, ahead } = compare(reading, north, south, zh);
  return (
    <tr>
      <td style={{ padding: "7px 24px 7px 0", color: INK_2, maxWidth: 340, verticalAlign: "top" }}>
        {reading.label}
        <Note>{reading.note}</Note>
      </td>
      <td style={{ ...cell, color: ahead === "north" ? CIV_COLOUR.north : undefined }}>
        {known ? reading.print(left!) : "—"}
      </td>
      <td style={{ ...cell, color: ahead === "south" ? CIV_COLOUR.south : undefined }}>
        {known ? reading.print(right!) : "—"}
      </td>
      <td style={{ padding: "7px 0", fontSize: 12, color: MUTED, whiteSpace: "nowrap", verticalAlign: "top" }}>
        <AheadNote ahead={ahead} gap={gap} zh={zh} higher={reading.higher} />
      </td>
    </tr>
  );
}

/**
 * One reading as a block: the two values, two bars on the reading's own shared scale, and the gap
 * in words.
 *
 * The bars are per-row and never accumulate into anything. They exist because two numbers in a
 * column are compared by arithmetic while two bars are compared by looking — and the length is only
 * ever the value against the larger of the same pair, which is the same fact the ratio beside it
 * already states.
 */
function ReadingCard({
  reading,
  north,
  south,
  zh,
  lang,
}: {
  reading: Reading;
  north: Row;
  south: Row;
  zh: boolean;
  lang: Lang;
}) {
  const { left, right, known, gap, ahead } = compare(reading, north, south, zh);
  const peak = known ? Math.max(Math.abs(left!), Math.abs(right!)) : 0;
  const rows: Array<{ civ: CivId; value: number | null }> = [
    { civ: "north", value: left },
    { civ: "south", value: right },
  ];
  return (
    <div style={{ padding: "10px 0", borderTop: `1px solid ${RULE}` }}>
      <div style={{ fontSize: 12.5, color: INK_2, lineHeight: 1.5 }}>{reading.label}</div>
      <div style={{ margin: "6px 0 4px" }}>
        {rows.map(({ civ, value }) => (
          <div key={civ} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
            <span style={{ fontSize: 11, color: CIV_COLOUR[civ], width: 46, flex: "0 0 auto" }}>
              {civLabel(civ, lang)}
            </span>
            <span
              style={{
                fontSize: 15,
                fontVariantNumeric: "tabular-nums",
                width: 62,
                flex: "0 0 auto",
                color: ahead === civ ? CIV_COLOUR[civ] : undefined,
              }}
            >
              {known ? reading.print(value!) : "—"}
            </span>
            <span style={{ flex: "1 1 0", minWidth: 0, height: 9, background: "#ece5d7" }}>
              <span
                style={{
                  display: "block",
                  height: "100%",
                  width: peak > 0 ? `${Math.min(100, (Math.abs(value ?? 0) / peak) * 100)}%` : "0%",
                  background: CIV_COLOUR[civ],
                  opacity: ahead === civ ? 1 : 0.55,
                }}
              />
            </span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: MUTED }}>
        <AheadNote ahead={ahead} gap={gap} zh={zh} higher={reading.higher} />
      </div>
      <Note>{reading.note}</Note>
    </div>
  );
}
