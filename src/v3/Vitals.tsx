import { CIV_COLOUR } from "./BeliefMap";
import { Note, useTeach } from "./RuleNote";
import { civLabel, useLang } from "./lang";
import { RULES } from "../sim/config";
import type { CivId, Frame, Tile } from "../sim/types";
import { readVitals, type Vital } from "./survival";

/**
 * Two questions the page could not answer, and both of them are the reason a model does anything.
 *
 * **Can they eat?** Stored food against upkeep is the only hard deadline in these rules: an N-food
 * shortfall kills N people before anybody acts. Printing the stockpile alone hides that — 40 food
 * is comfortable for four people and two turns from a funeral for twenty. So this prints the whole
 * sum: what is stored, what it costs to stand still, how many turns that buys, what is still in
 * backpacks on the way home, and what the standing orders should add next turn. A reader can then
 * see the difference between a model that keeps ten turns of slack and one that runs at two and
 * spends the rest of its people on something else.
 *
 * **Is home running out?** Every season so far has turned on this. Home food regrows and home
 * stone does not, so the stone number is a countdown to the turn when the only stone left is out
 * in the middle — which is the pressure the whole map is built to apply. Watching it fall is
 * watching the reason to leave arrive.
 *
 * Everything here is arithmetic on the current frame. Nothing is a forecast except the line
 * labelled as one, and none of it may ever reach a player.
 */

const RULE = "#ded5c4";
const MUTED = "#8a8172";
const INK_2 = "#55524a";
const WARN = "#9c3c3c";

export function Vitals({ frame, tiles }: { frame: Frame; tiles: Tile[] | null }) {
  const { lang } = useLang();
  const { teach } = useTeach();
  const zh = lang === "zh";
  const civs: CivId[] = ["north", "south"];
  const vitals = civs.map((civ) => readVitals(frame, tiles, civ));

  return (
    <section style={{ borderTop: `1px solid ${RULE}`, marginTop: 18, paddingTop: 14 }}>
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.1em",
          color: MUTED,
          textTransform: "uppercase",
          marginBottom: 10,
        }}
      >
        {zh ? "吃得飽嗎，家門口還剩多少" : "Can they eat, and is home running out"}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: 22,
        }}
      >
        {vitals.map((vital) => (
          <Card key={vital.civ} vital={vital} teach={teach} />
        ))}
      </div>

      <Note label={zh ? "糧食和石材的規則" : "how food and stone work"}>
        <p style={{ margin: 0 }}>
          {zh
            ? `每個人每回合吃 ${RULES.upkeep} 糧；糧食不足的回合最多餓死 ${RULES.starvationToll} 人，而且生育要等連續 ${RULES.famineRecoveryTurns} 回合交足口糧才恢復。每格糧地都顯示自己的再生量；石礦永不再生。`
            : `Everybody eats ${RULES.upkeep} food a turn. A hungry turn kills at most ${RULES.starvationToll} person, and births resume only after ${RULES.famineRecoveryTurns} consecutive fully fed turns. Each food cell shows its own regrowth; stone never regrows.`}
        </p>
      </Note>
    </section>
  );
}

function Card({ vital, teach }: { vital: Vital; teach: boolean }) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const thin = vital.turnsOfFood < 3;
  const net = vital.incoming - vital.upkeep;

  return (
    <div>
      <div style={{ color: CIV_COLOUR[vital.civ], fontSize: 15, marginBottom: 8 }}>
        {civLabel(vital.civ, lang)}
      </div>

      {/* The sum, written out. A reader who follows it once never has to be told the upkeep rule. */}
      <div style={{ fontSize: 13, lineHeight: 1.9 }}>
        <Row
          label={zh ? "倉裡的糧" : "food in store"}
          value={`${vital.stored}`}
          note={
            zh
              ? `每回合要吃 ${vital.upkeep}（${vital.upkeep / RULES.upkeep} 人 × ${RULES.upkeep}）`
              : `${vital.upkeep} eaten a turn (${vital.upkeep / RULES.upkeep} people × ${RULES.upkeep})`
          }
        />
        <Row
          label={zh ? "下回合預計入帳" : "expected in next turn"}
          value={`${vital.incoming > 0 ? "+" : ""}${vital.incoming}`}
          note={
            zh
              ? `${vital.gatherers.food} 人採糧、${vital.gatherers.stone} 人採石${hands(vital, zh)} · 淨 ${net >= 0 ? "+" : ""}${net}／回合`
              : `${vital.gatherers.food} on food, ${vital.gatherers.stone} on stone${hands(vital, zh)} · net ${net >= 0 ? "+" : ""}${net} a turn`
          }
          warn={(net < 0 && thin) || (vital.gatherState.stalled > 0 && vital.incoming === 0)}
        />
        {/* Two runways, both named, because they answer different questions and the page shows
            both. 食物續航 in the pressure panel divides by the *net* drain; this row's headline
            number divides by upkeep alone. Printing one without the other is how a reader ends up
            thinking "13 回合" and "6.5" are the same figure disagreeing with itself. */}
        <Row
          label={zh ? "夠撐多久" : "turns of food"}
          value={Number.isFinite(vital.turnsOfFood) ? vital.turnsOfFood.toFixed(1) : "—"}
          warn={thin}
          note={
            zh
              ? `如果現在停止採集${net < 0 ? `；照目前收支則 ${(vital.stored / -net).toFixed(1)} 回合` : "；目前收支為正，存糧在增加"}`
              : `if gathering stopped now${net < 0 ? `; ${(vital.stored / -net).toFixed(1)} at the current net rate` : "; at the current net rate the store is growing"}`
          }
        />
        <Row
          label={zh ? "路上未入倉" : "still in backpacks"}
          value={`${vital.inTransit}`}
          note={
            vital.inTransit > 0
              ? zh
                ? "背包裡的糧不能吃，要走回倉才算數"
                : "goods in a pack cannot be eaten; they must physically reach storage"
              : undefined
          }
        />
      </div>

      <div style={{ borderTop: `1px solid ${RULE}`, marginTop: 10, paddingTop: 8, fontSize: 13, lineHeight: 1.9 }}>
        <Row
          label={zh ? "家門口的糧" : "food left near home"}
          value={`${vital.homeFood}`}
          note={
            // Against the stockpile 7,841 is just a large number; against what these people eat it
            // is the finding. On v13 home regrew 16.5× the upkeep, which is why nobody ever left;
            // on corridor-tight it is 0.2×, which is the entire reason that map exists. Below 1×
            // the wording has to flip too — calling a pile that is being drawn down "an income"
            // says the opposite of what the number means.
            vital.upkeep <= 0
              ? zh
                ? `每回合自己長回 ${vital.homeRegen}`
                : `regrows ${vital.homeRegen} a turn`
              : vital.homeRegen >= vital.upkeep
                ? zh
                  ? `每回合自己長回 ${vital.homeRegen}，相當於他們食量的 ${(vital.homeRegen / vital.upkeep).toFixed(1)} 倍——這是收入，不是存貨`
                  : `regrows ${vital.homeRegen} a turn — ${(vital.homeRegen / vital.upkeep).toFixed(1)}× what these people eat, so it is an income, not a stock`
                : // Zero is not "a small income", and a ratio of 0.0× says the wrong thing about it:
                  // this ground has no income at all and every mouthful taken from it is gone. On
                  // `corridor-oasis` that is true of every field either side starts beside, so the
                  // reading a viewer needs is the deadline and where the answer to it is.
                  vital.homeRegen <= 0
                  ? zh
                    ? `這些地一點都不會長回來，採一份少一份——以現時食量約 ${Math.floor(vital.homeFood / vital.upkeep)} 個回合見底${vital.nextRenewFood ? `。最近一塊會再生的糧地在 ${vital.nextRenewFood} 格外` : ""}`
                    : `none of this regrows: every mouthful is gone for good — about ${Math.floor(vital.homeFood / vital.upkeep)} turns of it at what these people eat${vital.nextRenewFood ? `. The nearest food that does regrow is ${vital.nextRenewFood} tiles out` : ""}`
                  : zh
                    ? `每回合只長回 ${vital.homeRegen}，只有他們食量的 ${(vital.homeRegen / vital.upkeep).toFixed(1)} 倍——家門口的地養不起他們，這堆是會見底的`
                    : `regrows only ${vital.homeRegen} a turn, ${(vital.homeRegen / vital.upkeep).toFixed(1)}× what these people eat — home cannot feed them, so this pile is being drawn down`
          }
        />
        {/* Blocks, not stone, is the unit that matters: nobody can do anything with two stone. The
            warning therefore fires while there is still stone in the ground but no longer enough of
            it to build with — which is the turn the pressure actually starts. */}
        <Row
          label={zh ? "家門礦場尚餘" : "home quarry left"}
          value={`${vital.homeStone}`}
          warn={vital.homeStone < RULES.blockCost * 5}
          note={
            vital.homeStone < RULES.blockCost
              ? zh
                ? `已採光${vital.nextStone ? `，下一處石在 ${vital.nextStone} 格外` : ""}`
                : `exhausted${vital.nextStone ? `; the next stone is ${vital.nextStone} tiles out` : ""}`
              : vital.homeStone < RULES.blockCost * 5
                ? zh
                  ? `只夠再放 ${Math.floor(vital.homeStone / RULES.blockCost)} 個方塊${vital.nextStone ? `，下一處石在 ${vital.nextStone} 格外` : ""}`
                  : `only ${blocks(vital.homeStone)}${vital.nextStone ? `; the next stone is ${vital.nextStone} tiles out` : ""}`
                : zh
                  ? `不會長回來 · 約可換 ${Math.floor(vital.homeStone / RULES.blockCost)} 個方塊`
                  : `never regrows · about ${blocks(vital.homeStone)}`
          }
        />
      </div>

      {teach ? (
        <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.7, color: INK_2 }}>
          {reading(vital, zh)}
        </div>
      ) : null}
    </div>
  );
}

/** Stone is only ever spent in whole blocks, so that is the unit a reader should see it in. */
function blocks(stone: number) {
  const count = Math.floor(stone / RULES.blockCost);
  return `${count} more block${count === 1 ? "" : "s"}`;
}

/**
 * Why an order is or is not producing. A gatherer counts three ways and only one of them is work:
 * standing on a live source, still walking to it, or standing on one that has been emptied. The
 * last is invisible in a headcount and is the difference between "six people are feeding us" and
 * "six people are standing on bare ground" — so it is always named, and the working case is left
 * unsaid because it is the default the number already implies.
 */
function hands(vital: Vital, zh: boolean) {
  const parts: string[] = [];
  if (vital.gatherState.walking > 0) {
    parts.push(zh ? `${vital.gatherState.walking} 人還在路上` : `${vital.gatherState.walking} still walking`);
  }
  if (vital.gatherState.stalled > 0) {
    parts.push(
      zh
        ? `${vital.gatherState.stalled} 人站在已採光的地上`
        : `${vital.gatherState.stalled} standing on an emptied source`,
    );
  }
  if (!parts.length) return "";
  return zh ? `（${parts.join("、")}）` : ` (${parts.join(", ")})`;
}

/**
 * One sentence naming what the numbers add up to. It describes the world and the allocation, never
 * the model's intentions — a spectator page may say "two people are on stone", it may not say "this
 * model has decided to expand".
 */
function reading(vital: Vital, zh: boolean) {
  const onJobs = vital.gatherers.food + vital.gatherers.stone;
  const people = vital.upkeep / RULES.upkeep;
  const elsewhere = Math.max(0, people - onJobs);
  const stalled = vital.gatherState.stalled;

  // A stall leads the sentence only when it is actually costing them the harvest. Six people on a
  // bare tile while thirty food still arrives is worth a clause, not a headline — leading with it
  // either way would cry wolf on every card that has one idle order.
  if (stalled > 0 && (vital.incoming === 0 || vital.turnsOfFood < 6)) {
    return zh
      ? `${stalled} 人的採集命令指向已經採光的地，所以帳面上有 ${vital.gatherers.food} 人採糧，下回合實際只入 ${vital.incoming}。糧食尚餘 ${vital.turnsOfFood.toFixed(1)} 回合。`
      : `${stalled} people hold a gather order whose source is empty, so ${vital.gatherers.food} are nominally on food while only ${vital.incoming} arrives next turn. ${vital.turnsOfFood.toFixed(1)} turns of food left.`;
  }
  const aside = stalled
    ? zh
      ? `（其中 ${stalled} 人站在已採光的地上）`
      : ` (${stalled} of them on an emptied source)`
    : "";
  if (vital.turnsOfFood < 3) {
    return zh
      ? `糧食只夠 ${vital.turnsOfFood.toFixed(1)} 回合，其餘 ${elsewhere} 人不在採集崗位上。`
      : `Food covers ${vital.turnsOfFood.toFixed(1)} turns, and ${elsewhere} of the ${people} people are not on a gathering job.`;
  }
  if (vital.homeStone < RULES.blockCost * 5) {
    return zh
      ? `糧食有 ${vital.turnsOfFood.toFixed(1)} 回合餘裕，但家門礦場只剩 ${vital.homeStone}——之後的石材要走${vital.nextStone ? ` ${vital.nextStone} 格` : "出去"}才拿得到。`
      : `Food has ${vital.turnsOfFood.toFixed(1)} turns of slack, but the home quarry is down to ${vital.homeStone} — stone from here costs a walk${vital.nextStone ? ` of ${vital.nextStone} tiles` : ""}.`;
  }
  return zh
    ? `糧食有 ${vital.turnsOfFood.toFixed(1)} 回合餘裕；${vital.gatherers.food} 人採糧、${vital.gatherers.stone} 人採石${aside}、${elsewhere} 人在做別的事。`
    : `${vital.turnsOfFood.toFixed(1)} turns of food in hand; ${vital.gatherers.food} people on food, ${vital.gatherers.stone} on stone${aside}, ${elsewhere} on something else.`;
}

function Row({
  label,
  value,
  note,
  warn,
}: {
  label: string;
  value: string;
  note?: string;
  warn?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
      <span style={{ color: MUTED, minWidth: 108, fontSize: 12 }}>{label}</span>
      <span style={{ fontSize: 16, color: warn ? WARN : undefined, minWidth: 44 }}>{value}</span>
      {note ? <span style={{ fontSize: 11.5, color: warn ? WARN : MUTED }}>{note}</span> : null}
    </div>
  );
}
