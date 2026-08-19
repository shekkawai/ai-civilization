import { RULES } from "../sim/config";
import { useLang } from "./lang";

/**
 * What one worker is carrying, as the thing itself rather than as a number.
 *
 * The backpack is the whole of this simulation's logistics: goods are useless until they physically
 * reach storage, and a full pack sends a worker home whether or not the model wanted it to. "5 / 30"
 * says that; it does not *show* it. Thirty squares do — you can see at a glance that a worker two
 * turns from home is carrying almost nothing, which is the shape of every collapse in this project's
 * history.
 *
 * Three states, and the third is the one worth having:
 *   - **solid** — carried now, green for food and slate for stone.
 *   - **hatched** — what the standing job is expected to add before the pack is full or the source
 *     runs out. It is an estimate from the rules, never a promise, and it is labelled as one.
 *   - **empty** — space, drawn as an outline.
 */

const FOOD = "#6d8a4a";
const STONE = "#6b6f7a";
const EMPTY = "#ded5c4";
const MUTED = "#8a8172";

export interface Expectation {
  kind: "food" | "stone";
  amount: number;
  /** Short reason the estimate is what it is, e.g. "the tile holds 12". */
  note?: string;
}

export function Backpack({
  food,
  stone,
  expecting,
}: {
  food: number;
  stone: number;
  expecting?: Expectation;
}) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const carried = food + stone;
  const free = Math.max(0, RULES.carry - carried);
  const expected = expecting ? Math.max(0, Math.min(free, Math.round(expecting.amount))) : 0;

  const slots: Array<"food" | "stone" | "expect-food" | "expect-stone" | "empty"> = [];
  for (let index = 0; index < RULES.carry; index += 1) {
    if (index < food) slots.push("food");
    else if (index < carried) slots.push("stone");
    else if (expecting && index < carried + expected)
      slots.push(expecting.kind === "food" ? "expect-food" : "expect-stone");
    else slots.push("empty");
  }

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(15, 1fr)", gap: 2, maxWidth: 210 }}>
        {slots.map((slot, index) => (
          <Slot key={index} slot={slot} />
        ))}
      </div>
      {/* The colours have to be named where they are used. A green square means nothing until the
          sentence beside it says "green is food", and this panel is the only place that says it. */}
      <div style={{ fontSize: 12, marginTop: 6, display: "flex", flexWrap: "wrap", gap: "0 12px" }}>
        <span>
          <Chip colour={FOOD} /> {zh ? `糧 ${food}` : `${food} food`}
        </span>
        <span>
          <Chip colour={STONE} /> {zh ? `石 ${stone}` : `${stone} stone`}
        </span>
        <span style={{ color: MUTED }}>
          {zh ? `用 ${carried} / ${RULES.carry}，尚餘 ${free} 格` : `${carried} / ${RULES.carry} used, ${free} free`}
        </span>
      </div>
      {expecting && expected > 0 ? (
        <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>
          {zh
            ? `斜紋是預計還會裝到的 ${expected} ${expecting.kind === "food" ? "糧" : "石"}`
            : `Hatched is the ${expected} ${expecting.kind} this job is expected to add`}
          {expecting.note ? `（${expecting.note}）` : ""}
          {zh ? "。這是按規則推算，不是承諾。" : ". Estimated from the rules, not a promise."}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One physical hall or store, drawn with the same visual grammar as a worker's backpack.
 *
 * A hall can hold 200 spaces and a maximum-size store can hold 1,000, so drawing one DOM node per
 * unit would turn the inspector into a wall of pixels. Up to 200 cells are drawn; larger stores
 * group adjacent spaces into one cell. Each grouped cell uses proportional colour stops, while the
 * legend keeps the exact food, stone and empty counts visible.
 */
export function StorageSlots({
  food,
  stone,
  capacity,
}: {
  food: number;
  stone: number;
  capacity: number;
}) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const safeCapacity = Math.max(0, Math.round(capacity));
  const safeFood = Math.max(0, Math.min(safeCapacity, Math.round(food)));
  const safeStone = Math.max(0, Math.min(safeCapacity - safeFood, Math.round(stone)));
  const used = safeFood + safeStone;
  const free = Math.max(0, safeCapacity - used);
  const spacesPerCell = Math.max(1, Math.ceil(safeCapacity / 200));
  const cells = Array.from({ length: Math.ceil(safeCapacity / spacesPerCell) }, (_, index) => {
    const start = index * spacesPerCell;
    const end = Math.min(safeCapacity, start + spacesPerCell);
    return { start, end };
  });

  return (
    <div>
      <div
        aria-label={
          zh
            ? `這座倉存有 ${safeFood} 糧食、${safeStone} 石材、${free} 個空位`
            : `This storage structure holds ${safeFood} food and ${safeStone} stone with ${free} empty spaces`
        }
        style={{ display: "grid", gridTemplateColumns: "repeat(20, 1fr)", gap: 2, maxWidth: 250 }}
      >
        {cells.map(({ start, end }) => (
          <StorageSlot key={start} start={start} end={end} food={safeFood} stone={safeStone} />
        ))}
      </div>
      <div style={{ fontSize: 12, marginTop: 6, display: "flex", flexWrap: "wrap", gap: "0 12px" }}>
        <span>
          <Chip colour={FOOD} /> {zh ? `糧 ${safeFood}` : `${safeFood} food`}
        </span>
        <span>
          <Chip colour={STONE} /> {zh ? `石 ${safeStone}` : `${safeStone} stone`}
        </span>
        <span>
          <Chip colour="transparent" outline /> {zh ? `空 ${free}` : `${free} empty`}
        </span>
        <span style={{ color: MUTED }}>
          {zh ? `已用 ${used} / ${safeCapacity}` : `${used} / ${safeCapacity} used`}
        </span>
      </div>
      {spacesPerCell > 1 ? (
        <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>
          {zh
            ? `每小格代表最多 ${spacesPerCell} 個倉位；顏色比例及上方數字按實際存量。`
            : `Each square represents up to ${spacesPerCell} spaces; colour shares and the figures above use the exact stock.`}
        </div>
      ) : null}
    </div>
  );
}

function Chip({ colour, outline = false }: { colour: string; outline?: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 9,
        height: 9,
        background: colour,
        border: outline ? `1px solid ${EMPTY}` : "none",
        verticalAlign: "-1px",
      }}
    />
  );
}

function StorageSlot({
  start,
  end,
  food,
  stone,
}: {
  start: number;
  end: number;
  food: number;
  stone: number;
}) {
  const size = Math.max(1, end - start);
  const foodInCell = Math.max(0, Math.min(end, food) - start);
  const stoneStart = Math.max(start, food);
  const stoneEnd = Math.min(end, food + stone);
  const stoneInCell = Math.max(0, stoneEnd - stoneStart);
  const foodStop = (foodInCell / size) * 100;
  const stoneStop = ((foodInCell + stoneInCell) / size) * 100;
  const empty = foodInCell + stoneInCell <= 0;
  const background = empty
    ? "transparent"
    : foodInCell > 0 && stoneInCell > 0
      ? `linear-gradient(to right, ${FOOD} 0 ${foodStop}%, ${STONE} ${foodStop}% ${stoneStop}%, transparent ${stoneStop}% 100%)`
      : foodInCell > 0
        ? `linear-gradient(to right, ${FOOD} 0 ${foodStop}%, transparent ${foodStop}% 100%)`
        : `linear-gradient(to right, ${STONE} 0 ${stoneStop}%, transparent ${stoneStop}% 100%)`;

  return (
    <div
      title={`${start + 1}–${end}`}
      style={{
        aspectRatio: "1",
        minWidth: 0,
        border: `1px solid ${empty ? EMPTY : foodInCell > 0 ? FOOD : STONE}`,
        background,
      }}
    />
  );
}

function Slot({ slot }: { slot: "food" | "stone" | "expect-food" | "expect-stone" | "empty" }) {
  const colour = slot.endsWith("food") ? FOOD : slot.endsWith("stone") ? STONE : EMPTY;
  const hatched = slot.startsWith("expect");
  return (
    <div
      style={{
        aspectRatio: "1",
        border: `1px solid ${slot === "empty" ? EMPTY : colour}`,
        background:
          slot === "empty"
            ? "transparent"
            : hatched
              ? `repeating-linear-gradient(45deg, ${colour} 0 2px, transparent 2px 4px)`
              : colour,
      }}
    />
  );
}
