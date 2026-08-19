/** Declared here rather than imported from `./i18n`, so the engine can use this file. */
export type Lang = "zh" | "en";

/**
 * Every sentence the engine can write, in both languages, in one table.
 *
 * Through protocol 16 the engine wrote Traditional Chinese into the database and this file
 * rendered English for readers who wanted it. From protocol 17 the engine writes **English** —
 * Shek's call on 2026-08-11, because a model's prompt should be one language and the mixed prompt
 * was a confound on how the models chose theirs. The direction reverses; the table does not, so
 * the seasons already stored in Chinese keep replaying and reading correctly.
 *
 * Anything unmatched falls through untouched and is marked as original text by the UI.
 * Names in 「」 are written by the models themselves and are always kept verbatim.
 */

/** Short fragments that appear joined together inside a failure sentence. */
const FRAGMENTS: Array<[RegExp, string]> = [
  [/^這片地超出了我們所知的世界。$/, "That ground lies beyond the world we know."],
  [/^地基壓在水上。$/, "The foundation would sit on water."],
  [/^地基壓在山脊上。$/, "The foundation would sit on a ridge."],
  [/^這片地已有建築或工地。$/, "That ground already holds a building or a worksite."],
  [/^這片地距離我們的建築超過 (\d+) 格。$/, "That ground is more than $1 tiles from any building of ours."],
  [/^同一塊地上同時開工。$/, "Two worksites were started on the same ground."],
  [/^起始聚居地的設計不能再次放置。$/, "The starting hall's design cannot be placed again."],
  [/^這個設計在本回合開始時還不存在。$/, "That design did not exist when this turn began."],
  [/^工地沒有任何目前看得見的設計格。$/, "No cell of the design is currently visible."],
  // Design-check failures, composed into "Design 「x」 was rejected: …" by the caller.
  [/^設計是空的。$/, "The design is empty."],
  [/^只可以使用 # 和 \. 兩種符號。$/, "Only the symbols # and . may be used."],
  [/^佔地不可超過 (\d+) × (\d+) 格。$/, "The footprint may not exceed $1 × $2 cells."],
  [/^方塊不可超過 (\d+) 個。$/, "There may not be more than $1 blocks."],
  [/^(\S+) 至少需要 (\d+) 個方塊，現時只有 (\d+) 個。$/, "A $1 needs at least $2 blocks and this has only $3."],
  [/^所有方塊必須連成一體。$/, "Every block must be connected to the others."],
  [/^這片地距離我們的聚居地或倉庫超過 (\d+) 格。$/, "That ground is more than $1 tiles from a hall or store of ours."],
];

function translateFragments(text: string) {
  return text
    .split(" ")
    .map((part) => {
      for (const [pattern, replacement] of FRAGMENTS) {
        if (pattern.test(part)) return part.replace(pattern, replacement);
      }
      return part;
    })
    .join(" ");
}

const RESOURCE: Record<string, string> = { 糧食: "food", 石材: "stone" };

const PATTERNS: Array<[RegExp, string | ((match: RegExpMatchArray) => string)]> = [
  [
    /^世界建立。兩邊的地形、資源與距離完全相同。$/,
    "The world is created. Terrain, resources and distances are identical on both sides.",
  ],
  [/^糧倉見底，(\d+) 名工人餓死。$/, "The granary ran dry — $1 workers starved."],
  [
    /^一名餓死工人攜帶的 (\d+) 糧食與 (\d+) 石材掉在地上。$/,
    "$1 food and $2 stone carried by a starved worker fell to the ground.",
  ],
  [
    /^完成設計「(.+)」：(\d+) 個方塊，需要 (\d+) 石材。$/,
    "Design 「$1」 finished — $2 blocks, $3 stone required.",
  ],
  [
    /^設計「(.+)」未獲通過：(.+)$/,
    (match) => `Design 「${match[1]}」 was rejected: ${translateFragments(match[2])}`,
  ],
  [/^設計庫已滿。$/, "The design library is full."],
  [/^向對方傳話：「(.+)」$/, "Sent word to the other side: 「$1」"],
  [
    /^建造沒有開始：(.+) 沒有放下方塊，地面維持原狀。$/,
    (match) =>
      `Construction never started: ${translateFragments(match[1])} No block was placed and the ground is unchanged.`,
  ],
  [/^工人重新加入「(.+)」的工地。$/, "Workers rejoined the 「$1」 worksite."],
  [
    /^「(.+)」動工。石材必須由工人一趟趟搬到工地。$/,
    "「$1」 broke ground. Stone has to be carried to the site trip by trip.",
  ],
  [/^「(.+)」落成。$/, "「$1」 is finished."],
  [/^修補了 (\d+) 個方塊。$/, "Repaired $1 blocks."],
  [/^「(.+)」已被完全拆走。$/, "「$1」 has been taken completely apart."],
  [
    /^「(.+)」倒下，(\d+) 糧食與 (\d+) 石材散落一地，任何人都可以拾走。$/,
    "「$1」 came down. $2 food and $3 stone spilled across the ground, free for anyone to pick up.",
  ],
  [
    /^有不屬於我們的工人在拆解「(.+)」的外圍。$/,
    "Workers who are not ours are taking apart the outer edge of 「$1」.",
  ],
  [/^從「(.+)」取走 (\d+) 個方塊的石材。$/, "Took the stone from $2 blocks of 「$1」."],
  [/^拆解自己的「(.+)」，回收 (\d+) 石材。$/, "Took apart our own 「$1」, recovering $2 stone."],
  [
    /^斥候在遠處看見一些人，他們不是我們的人。$/,
    "Scouts saw people in the distance. They are not ours.",
  ],
  [
    /^聚居地有足夠空間與糧食，一名成年人加入；使用了 (\d+) 糧食。$/,
    "The settlement had room and food to spare, so one adult joined — $1 food spent.",
  ],
  [
    /^已完成建築只能容納 (\d+) 人；一名超出容量的居民離開，隨身物資留在原地。$/,
    "Completed structures can house only $1 people; one resident beyond capacity left, leaving carried goods on the ground.",
  ],
  [/^移走了 (\d+) 個暴露方塊。$/, "Removed $1 exposed blocks."],
  [/^工地增加了 (\d+) 個方塊。$/, "$1 blocks were added to the worksite."],
  [
    /^\((\d+), (\d+)\) 有工人站立，這個方塊本回合沒有放下。$/,
    "A worker was standing at ($1, $2), so that block was not laid this turn.",
  ],
  // Per-worker job results.
  [/^(\S+) 的工作已停止：目標已不存在。$/, "$1 stopped working: the target no longer exists."],
  [
    /^(\S+) 的工作無法繼續：目的已不存在或沒有可用位置。$/,
    "$1 cannot continue: the destination is gone or has no free spot.",
  ],
  [/^(\S+) 無法繼續工作：找不到通路。$/, "$1 cannot continue: no route was found."],
  [/^(\S+) 無法前進：該地格已有人站立。$/, "$1 cannot advance: someone already stands on that ground."],
  [/^(\S+) 無法採集：資源位置被方塊覆蓋。$/, "$1 cannot gather: the resource is covered by a block."],
  [
    /^(\S+) 無法卸下物資：所有存放處都已滿，背包內的物資仍由工人攜帶。$/,
    "$1 cannot unload: every store is full, so the goods stay in the backpack.",
  ],
  [
    /^(\S+) 採集了 (\d+) (糧食|石材)。$/,
    (match) => `${match[1]} gathered ${match[2]} ${RESOURCE[match[3]]}.`,
  ],
  [
    /^(\S+) 從地上拾起 (\d+) (糧食|石材)。$/,
    (match) => `${match[1]} picked up ${match[2]} ${RESOURCE[match[3]]} from the ground.`,
  ],
  [/^(\S+) 存入 (\d+) 份物資。$/, "$1 deposited $2 units of goods."],
  [/^(\S+) 存入 (\d+) 糧食。$/, "$1 deposited $2 food."],
  [/^(\S+) 取出 (\d+) 石材。$/, "$1 withdrew $2 stone."],
  [/^(\S+) 把 (\d+) 石材送到工地。$/, "$1 delivered $2 stone to the worksite."],
  [/^(\S+) 本回合已收到另一項新指示。$/, "$1 already received another order this turn."],
  [/^關於 (\S+) 的指示無法執行：那不是我們的人。$/, "The order for $1 cannot run: that is not one of our people."],
  // Order-level rejections.
  [/^這項指示沒有指定工人。$/, "That order named no workers."],
  [/^這項指示包含太多工人。$/, "That order named too many workers."],
  [/^這項指示超出本回合上限。$/, "That order exceeds this turn's limit."],
  [/^指定的建築不存在。$/, "The named building does not exist."],
  [/^我們從未看過這座建築。$/, "We have never seen that building."],
  [/^我們從未看過這個採集位置。$/, "We have never seen that gathering spot."],
  [/^我們未曾遇見這些人。$/, "We have never met those people."],
  [/^訊息無法送出：我們未曾遇見這些人。$/, "The message could not be sent: we have never met those people."],
  [/^訊息將在下一回合送達。$/, "The message arrives next turn."],
  [/^本回合已經傳過一次話。$/, "A message was already sent this turn."],
  [/^只能修補自己的建築。$/, "Only our own buildings can be repaired."],
  [
    /^這座建築沒有已放下後又缺失的方塊；尚未建造的格不是修補目標。$/,
    "That building has no block that was laid and then lost; cells never built are not repair targets.",
  ],
  [/^採集位置不在世界範圍內。$/, "That gathering spot lies outside the world."],
  [/^目的地不在世界範圍內。$/, "That destination lies outside the world."],
  [/^這個位置沒有可採集的物資。$/, "There is nothing to gather at that spot."],
  [/^指定工人沒有攜帶物資。$/, "The named workers are carrying nothing."],
  [/^攜帶物資的工人正返回最近的存放處。$/, "Workers carrying goods are heading for the nearest store."],
  [
    /^攜帶物資的工人會先按本地空位篩選可用存放處，再沿最短可達路徑返回。$/,
    "Workers carrying goods first filter storage by local free room, then return along the shortest reachable path.",
  ],
  [/^工人已加入現有工地。$/, "Workers joined the existing worksite."],
  [/^建造工作已開始。$/, "Construction has begun."],
  [/^工人已收到新指示。$/, "The workers received their new orders."],
  [
    /^聚居地有空位，一名孩子長大成人加入勞動；他每回合開始要吃 (\d+) 糧食。$/,
    "There is room in the settlement and a child has come of age to work; they eat $1 food at the start of every turn.",
  ],
  [/^沒有足夠居所，新人無法留下。$/, "There is not enough shelter for anybody new to stay."],
  [/^(\d+) 名新工人加入。$/, "$1 new workers joined."],
  [
    /^已完成建築共 (\d+) 塊，本回合石材維護需要 (\d+)；已支付 (\d+)，失去 (\d+) 塊。$/,
    "Completed buildings stand at $1 blocks; upkeep this turn needed $2 stone; $3 was paid and $4 blocks were lost.",
  ],
  [
    /^(\S+) 在 \((\d+),(\d+)\) 放下 (\d+) 糧食與 (\d+) 石材，任何人都可以拾走。$/,
    "$1 set down $4 food and $5 stone at ($2,$3), where anybody may pick them up.",
  ],
  [/^物資已放在地上。$/, "The goods are on the ground."],
  [/^我們的人不懂得這樣做。$/, "Our people do not know how to do that."],
  [/^放下的數量不可以是負數。$/, "An amount to set down cannot be negative."],
  [/^設計已保存。$/, "The design is saved."],
  [/^記事已更新。$/, "The chronicle is updated."],
  [/^稱呼已記下。$/, "The name is noted."],
];

export interface TranslatedEvent {
  text: string;
  /** False when no pattern matched, so the UI can mark it as original engine text. */
  translated: boolean;
}

/**
 * Reverse direction, derived from the table above rather than written twice.
 *
 * From protocol 17 the engine writes English, so a Chinese reader needs en → zh — and a
 * hand-maintained second table would drift the first time somebody edits one side only. Every
 * `[zhPattern, enTemplate]` pair uses `$1…$n` in the same order, so the pair can be inverted
 * mechanically: the English template becomes the matcher and the Chinese pattern source becomes
 * the template. Function-valued replacements cannot be inverted and are skipped; their English
 * simply shows through, which is the same fallback an unmatched sentence already gets.
 *
 * `test/engine.test.ts` round-trips every real sentence shape through both directions, so a bad
 * inversion fails the suite instead of reaching a reader.
 */
const CAPTURE = /\((?:\\d\+|\.\+|\\S\+|[^()]*\|[^()]*)\)/g;

function invert([pattern, replacement]: (typeof PATTERNS)[number]): [RegExp, string] | null {
  if (typeof replacement !== "string") return null;
  const captures = pattern.source.match(CAPTURE) ?? [];
  // The Chinese side, with its capture groups turned back into positional placeholders.
  let index = 0;
  // `source` may carry non-ASCII as \uXXXX depending on how the file was parsed, so those are
  // decoded before the generic unescape — otherwise the backslash strip leaves bare "u4E16".
  const zhTemplate = pattern.source
    .replace(/^\^|\$$/g, "")
    .replace(CAPTURE, () => `$${++index}`)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\(.)/g, "$1");
  // The English side, escaped into a matcher whose groups are as strict as the Chinese ones were.
  const enSource = replacement
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\$(\d)/g, (_, position: string) => captures[Number(position) - 1] ?? "(.+)");
  return [new RegExp(`^${enSource}$`), zhTemplate];
}

/**
 * The two entries above that pick a word out of a lookup cannot be inverted mechanically, and they
 * are also the two most common sentences in the game — a Chinese reader must not meet them in
 * English. They are written out per resource instead, which the round-trip test then checks.
 */
const MANUAL_REVERSE: Array<[RegExp, string]> = [
  [/^(\S+) gathered (\d+) food\.$/, "$1 採集了 $2 糧食。"],
  [/^(\S+) gathered (\d+) stone\.$/, "$1 採集了 $2 石材。"],
  [/^(\S+) picked up (\d+) food from the ground\.$/, "$1 從地上拾起 $2 糧食。"],
  [/^(\S+) picked up (\d+) stone from the ground\.$/, "$1 從地上拾起 $2 石材。"],
];

const REVERSED: Array<[RegExp, string]> = [
  ...MANUAL_REVERSE,
  ...PATTERNS.map(invert).filter((entry): entry is [RegExp, string] => entry !== null),
];

/**
 * One sentence, or several joined with a space. The engine composes failures by joining clauses,
 * so a whole-string match is tried first and clause-splitting is only the fallback — otherwise a
 * quoted letter containing a full stop would be torn apart.
 */
function applyTable(text: string, table: Array<[RegExp, string | ((match: RegExpMatchArray) => string)]>) {
  for (const [pattern, replacement] of table) {
    const match = text.match(pattern);
    if (!match) continue;
    return typeof replacement === "function" ? replacement(match) : text.replace(pattern, replacement);
  }
  return null;
}

function translateClauses(
  text: string,
  table: Array<[RegExp, string | ((match: RegExpMatchArray) => string)]>,
) {
  const clauses = text.split(" ").filter((clause) => clause.length > 0);
  if (clauses.length < 2) return null;
  const rendered = clauses.map((clause) => applyTable(clause, table));
  if (rendered.some((clause) => clause === null)) return null;
  return rendered.join(" ");
}

/**
 * Which language the engine wrote this sentence in — decided by the sentence, not the season, so
 * one reader can scrub from a protocol-16 season to a protocol-17 one without the text flipping.
 * Names in 「」 are the models' own and say nothing about the engine, so they are ignored.
 */
function writtenIn(text: string): Lang {
  return /[一-鿿]/.test(text.replace(/「[^」]*」/g, "")) ? "zh" : "en";
}

export function translateEventText(text: string, lang: Lang): TranslatedEvent {
  if (writtenIn(text) === lang) return { text, translated: true };
  const table = lang === "en" ? PATTERNS : REVERSED;
  const whole = applyTable(text, table);
  if (whole !== null) return { text: whole, translated: true };
  const composed = translateClauses(text, table);
  if (composed !== null) return { text: composed, translated: true };
  return { text, translated: false };
}

/**
 * What the engine writes into the world from protocol 17 onward.
 *
 * Authoring the sentences in Chinese and rendering English here — rather than the reverse — keeps
 * one table as the single source of truth for both the stored record and every reader. A sentence
 * this cannot render is a bug, not a fallback: `test/engine.test.ts` asserts a scripted
 * protocol-17 season emits no Chinese at all.
 */
export function engineEnglish(text: string): string {
  return translateEventText(text, "en").text;
}
