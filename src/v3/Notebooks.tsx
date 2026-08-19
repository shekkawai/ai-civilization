import { useEffect, useMemo, useRef, useState } from "react";
import { api, type CivMemory, type MemoryEntry, type SeasonMemory } from "./api";
import { CIV_COLOUR } from "./BeliefMap";
import { Caption } from "./RuleNote";
import { civLabel, useLang, type Lang } from "./lang";
import { useNarrow } from "./responsive";
import type { CivId } from "../sim/types";

/**
 * The four things a model writes for itself, in full.
 *
 * A prompt carries exactly four self-authored surfaces from one turn to the next: standing orders,
 * the chronicle, the notebook, and the previous journal entry. Three of the four were invisible
 * here — the page showed the journal of whichever turn the playhead sat on and nothing else — so
 * the text that actually steers a decision fifty turns after it was written could not be read at
 * all. In v39 the southern model rewrote its notebook on every single turn and the northern one
 * never opened one; from the site those two behaviours looked identical.
 *
 * Drawn in the claim register, verbatim, never translated. The engine never corrects any of it: a
 * misunderstanding written at turn 20 and still quoted at turn 200 is the most valuable thing this
 * simulation can produce, and it only shows up if the revisions are readable side by side.
 *
 * **Laid out surface-major, one row per surface with the two civilizations inside it** (Shek's
 * call, 2026-08-18). The first build was civ-major — a column per civilization with all four
 * surfaces stacked down it — and that cannot hold, because the two columns are not the same
 * length and nothing keeps them in step. By v39's turn 41 the south had written ~154,000
 * characters against the north's ~30,000, so the north column ran out entirely while the south
 * was still on its second surface: a reader scrolling the middle of the section had the north's
 * turn journal beside the south's chronicle, which is the one comparison this section exists to
 * make and the only one it was failing to support. A row per surface keeps the pair aligned at
 * every scroll position no matter how lopsided the two records become.
 */

const RULE = "#ded5c4";
const MUTED = "#8a8172";
const INK = "#4a443c";
const INK_2 = "#55524a";
const CLAIM_BG = "#f7f3ea";

/**
 * How tall a passage may stand before it is clamped.
 *
 * Clamped and disclosed, never scrolled. These boxes used to be `overflow-y: auto`, which put a
 * scroll region inside a long page: on a phone a drag that starts on a notebook page moves the
 * notebook instead of the page, and there is no edge to escape from because the box is wider than
 * the screen. A reader could be trapped in the middle of the south's 3,582-character notebook.
 * The page itself is the only scroll surface here now.
 */
const CLAMP_HEIGHT = 220;

type Surface = "standingOrders" | "notebook" | "chronicle" | "journal";

const SURFACES: Array<{
  key: Surface;
  zh: string;
  en: string;
  /** What this surface is, in the model's own economy of memory. */
  zhNote: (memory: SeasonMemory) => string;
  enNote: (memory: SeasonMemory) => string;
  /** Append-only surfaces read as a list; replaced surfaces read as a current version plus history. */
  append?: boolean;
}> = [
  {
    key: "standingOrders",
    zh: "常規指令",
    en: "Standing orders",
    zhNote: (memory) =>
      `每回合原文帶入下一個提示，模型隨時可以整段改寫，上限 ${memory.limits.standingOrders} 字元。`,
    enNote: (memory) =>
      `Carried verbatim into every next prompt and replaced wholesale whenever the model sends new ones, up to ${memory.limits.standingOrders} characters.`,
  },
  {
    key: "notebook",
    zh: "筆記本",
    en: "Notebook",
    zhNote: (memory) =>
      `模型用 note 動作整本覆寫，上限 ${memory.limits.notebook} 字元。這是它唯一可以自由儲存長期資料的地方。`,
    enNote: (memory) =>
      `Overwritten in full by a note action, up to ${memory.limits.notebook} characters. It is the only place a model can freely keep anything long-term.`,
  },
  {
    key: "chronicle",
    zh: "編年",
    en: "Chronicle",
    zhNote: (memory) => `只能新增、不能刪改，而且只有第 ${memory.limits.chronicleInterval} 的倍數回合可以寫一行。`,
    enNote: (memory) =>
      `Append-only — nothing here can be edited or removed — and one line may be added only on turns divisible by ${memory.limits.chronicleInterval}.`,
    append: true,
  },
  {
    key: "journal",
    zh: "每回合日誌",
    en: "Turn journal",
    zhNote: (memory) =>
      `每回合一則，上限 ${memory.limits.journal} 字元。只有最近一則會帶入下一個提示，其餘全部由模型自己遺忘。`,
    enNote: (memory) =>
      `One entry per turn, up to ${memory.limits.journal} characters. Only the latest is carried into the next prompt; the rest the model simply forgets.`,
    append: true,
  },
];

/**
 * A passage of the model's own text, clamped with a disclosure rather than an inner scrollbar.
 *
 * Measured rather than guessed: character count is a bad proxy here because the same 900 characters
 * are three lines on a desktop column and twelve on a phone, so the control would appear on
 * passages that fit and be missing from passages that do not.
 */
function Body({ text }: { text: string }) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || open) return;
    // `overflow: hidden` still reports the full content height, so this measures the passage as
    // written rather than as displayed.
    setClamped(element.scrollHeight > CLAMP_HEIGHT + 8);
  }, [text, open]);

  const collapsed = clamped && !open;
  return (
    <>
      <div style={{ position: "relative" }}>
        <div
          ref={ref}
          style={{
            fontSize: 13,
            lineHeight: 1.75,
            color: INK,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            background: CLAIM_BG,
            border: `1px solid ${RULE}`,
            padding: "8px 10px",
            maxHeight: collapsed ? CLAMP_HEIGHT : undefined,
            overflow: "hidden",
          }}
        >
          {text}
        </div>
        {collapsed ? (
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: 1,
              right: 1,
              bottom: 1,
              height: 48,
              background: `linear-gradient(to bottom, rgba(247,243,234,0), ${CLAIM_BG})`,
              pointerEvents: "none",
            }}
          />
        ) : null}
      </div>
      {clamped ? (
        <button
          onClick={() => setOpen((value) => !value)}
          style={{
            marginTop: 4,
            border: "none",
            background: "transparent",
            color: MUTED,
            fontFamily: "inherit",
            fontSize: 12,
            padding: 0,
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          {open ? (zh ? "收起" : "Collapse") : zh ? "讀全文" : "Read in full"}
        </button>
      ) : null}
    </>
  );
}

function Stamp({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, color: MUTED, margin: "0 0 4px" }}>{children}</div>;
}

/**
 * A surface that the model replaces wholesale: the version standing at the playhead, plus every
 * earlier version behind a disclosure. Identical resubmissions are not revisions and were dropped
 * upstream, so a count here is a count of times the model actually changed its mind.
 */
function Replaced({ entries, zh }: { entries: MemoryEntry[]; zh: boolean }) {
  const current = entries.at(-1);
  const earlier = entries.slice(0, -1).reverse();
  if (!current) return null;
  return (
    <>
      <Stamp>
        {zh
          ? `目前這一版寫於第 ${current.turn} 回合 · 原文照錄`
          : `The version standing now was written on turn ${current.turn} · verbatim`}
      </Stamp>
      <Body text={current.text} />
      {earlier.length > 0 ? (
        <details style={{ marginTop: 6 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, color: MUTED }}>
            {zh
              ? `之前的 ${earlier.length} 版`
              : `${earlier.length} earlier version${earlier.length === 1 ? "" : "s"}`}
          </summary>
          <div style={{ marginTop: 6 }}>
            {earlier.map((entry) => (
              <div key={entry.turn} style={{ marginTop: 8 }}>
                <Stamp>{zh ? `第 ${entry.turn} 回合` : `Turn ${entry.turn}`}</Stamp>
                <Body text={entry.text} />
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}

/**
 * A surface that only ever grows. Newest first, because on a long season the recent lines are the
 * ones a reader is scrubbing against; the whole run stays behind one disclosure.
 */
function Appended({ entries, zh }: { entries: MemoryEntry[]; zh: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const newestFirst = [...entries].reverse();
  const shown = expanded ? newestFirst : newestFirst.slice(0, 3);
  const hidden = newestFirst.length - shown.length;
  return (
    <>
      {shown.map((entry) => (
        <div key={entry.turn} style={{ marginTop: 8 }}>
          <Stamp>{zh ? `第 ${entry.turn} 回合 · 原文照錄` : `Turn ${entry.turn} · verbatim`}</Stamp>
          <Body text={entry.text} />
        </div>
      ))}
      {hidden > 0 ? (
        <button
          onClick={() => setExpanded(true)}
          style={{
            marginTop: 8,
            border: `1px solid ${RULE}`,
            background: "transparent",
            color: MUTED,
            fontFamily: "inherit",
            fontSize: 12,
            padding: "4px 10px",
            cursor: "pointer",
          }}
        >
          {zh ? `展開較早的 ${hidden} 則` : `Show the ${hidden} earlier entries`}
        </button>
      ) : null}
    </>
  );
}

/**
 * How much of each surface each side has written, before a word of it is read.
 *
 * The single most useful fact in this section is a count, not a passage: one model kept a notebook
 * every turn and the other never opened one. Read as text that takes a scroll and a comparison to
 * notice; read as eight numbers it takes a second, and the passages below then answer "why" rather
 * than "whether". A zero is set in full ink because a surface a model never touched is a decision
 * it made, not missing data.
 */
function Shape({ memory, zh, lang }: { memory: SeasonMemory; zh: boolean; lang: Lang }) {
  const civs: CivId[] = ["north", "south"];
  return (
    <div style={{ margin: "12px 0 4px", overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr>
            <th />
            {civs.map((civ) => (
              <th
                key={civ}
                style={{
                  textAlign: "left",
                  fontWeight: 400,
                  color: CIV_COLOUR[civ],
                  padding: "0 0 4px 18px",
                  whiteSpace: "nowrap",
                }}
              >
                {civLabel(civ, lang)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SURFACES.map((surface) => (
            <tr key={surface.key}>
              <td style={{ color: INK_2, padding: "3px 0", whiteSpace: "nowrap" }}>
                {zh ? surface.zh : surface.en}
              </td>
              {civs.map((civ) => {
                const count = memory.civs[civ]?.[surface.key].length ?? 0;
                return (
                  <td
                    key={civ}
                    style={{
                      padding: "3px 0 3px 18px",
                      whiteSpace: "nowrap",
                      color: count === 0 ? INK : MUTED,
                    }}
                  >
                    {count === 0
                      ? zh
                        ? "一次都沒有寫過"
                        : "never written"
                      : surface.append
                        ? zh
                          ? `${count} 則`
                          : `${count} entries`
                        : zh
                          ? `改過 ${count} 次`
                          : `${count} version${count === 1 ? "" : "s"}`}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One civilization's half of one surface. The surface's name and rule are stated once, above. */
function Half({
  civ,
  entries,
  append,
  lang,
  zh,
  empty,
  count,
}: {
  civ: CivId;
  entries: MemoryEntry[];
  append: boolean;
  lang: Lang;
  zh: boolean;
  /** Overrides "never written" when the list is empty for a reason other than silence. */
  empty?: string;
  /**
   * How much this side has written, when that differs from how much is listed here. The turn
   * journal lists one entry fewer than it holds, because the newest is quoted at the top of the
   * panel; the badge must still agree with the count table above or one of the two reads as wrong.
   */
  count?: number;
}) {
  const total = count ?? entries.length;
  return (
    <div>
      <div style={{ fontSize: 13, color: CIV_COLOUR[civ], marginBottom: 6 }}>
        {civLabel(civ, lang)}
        <span style={{ color: MUTED, fontSize: 11.5, marginLeft: 6 }}>
          {total === 0
            ? ""
            : append
              ? zh
                ? `${total} 則`
                : `${total} entries`
              : zh
                ? `改過 ${total} 次`
                : `${total} version${total === 1 ? "" : "s"}`}
        </span>
      </div>
      {entries.length === 0 ? (
        // Not an empty cell to skip past. A model that never opened its notebook made a choice, and
        // it is one of the clearest differences between the two sides.
        <div style={{ fontSize: 12.5, color: MUTED }}>
          {empty ??
            (zh
              ? `到這一回合為止，${civLabel(civ, lang)}一次都沒有寫過。`
              : `${civLabel(civ, lang)} had not written here even once by this turn.`)}
        </div>
      ) : append ? (
        <Appended entries={entries} zh={zh} />
      ) : (
        <Replaced entries={entries} zh={zh} />
      )}
    </div>
  );
}

/**
 * Fetched once per season advance and clipped in the browser, not once per turn on the server.
 *
 * The full record is the largest payload on the page — every version of a 12,000-character
 * notebook — and the playhead moves on every drag of the timeline. Asking the server per turn
 * would refetch the whole season on each frame of a scrub. The turn stamps travel with the text,
 * so clipping is a filter here; the server's own clip stays for anybody reading the endpoint
 * directly. Nothing is requested until a reader actually opens this panel.
 */
export function Notebooks({
  seasonId,
  turn,
  maxTurn,
  active,
}: {
  seasonId: string;
  turn: number;
  maxTurn: number;
  active: boolean;
}) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const narrow = useNarrow();
  const [memory, setMemory] = useState<SeasonMemory | null>(null);
  const [opened, setOpened] = useState(active);

  useEffect(() => {
    if (active) setOpened(true);
  }, [active]);

  useEffect(() => {
    if (!opened) return;
    let live = true;
    api.memory(seasonId, maxTurn).then((payload) => {
      if (live) setMemory(payload);
    });
    return () => {
      live = false;
    };
  }, [seasonId, maxTurn, opened]);

  const clipped = useMemo(() => {
    if (!memory) return null;
    const civs = Object.fromEntries(
      (["north", "south"] as CivId[]).map((civ) => {
        const civMemory = memory.civs[civ];
        return [
          civ,
          {
            standingOrders: civMemory.standingOrders.filter((entry) => entry.turn <= turn),
            notebook: civMemory.notebook.filter((entry) => entry.turn <= turn),
            chronicle: civMemory.chronicle.filter((entry) => entry.turn <= turn),
            journal: civMemory.journal.filter((entry) => entry.turn <= turn),
          } satisfies CivMemory,
        ];
      }),
    ) as Record<CivId, CivMemory>;
    return { ...memory, civs };
  }, [memory, turn]);

  return (
    <section style={{ borderTop: `1px solid ${RULE}`, marginTop: 20, paddingTop: 16 }}>
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.08em",
          color: MUTED,
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        {zh ? "它們寫給自己的字" : "What they wrote for themselves"}
      </div>
      <Caption>
        {zh
          ? "這裡是兩個模型自己保存的全部文字，原文照錄。系統從不修正、也不提醒它們哪一句已經過時：第 20 回合寫錯的一句話，可以一路指揮到第 200 回合。四種文字的規則不同，所以分開排列，每一種都南北並排。"
          : "Everything the two models keep for themselves, verbatim. The system never corrects any of it and never flags a line as stale, so a sentence written wrongly at turn 20 can still be steering decisions at turn 200. The four surfaces follow different rules, so each is read on its own row with the two sides beside each other."}
      </Caption>
      {!clipped ? (
        <div style={{ fontSize: 13, color: MUTED }}>{zh ? "載入中……" : "Loading…"}</div>
      ) : (
        <>
          <Shape memory={clipped} zh={zh} lang={lang} />
          <div style={{ fontSize: 12.5, color: MUTED, margin: "8px 0 4px" }}>
            {zh
              ? `截至第 ${turn} 回合為止已寫下的文字。往回拉時間軸，就只會看到當時已經存在的版本。`
              : `Everything written through turn ${turn}. Scrub back and you see only the versions that existed then.`}
          </div>
          {SURFACES.map((surface) => {
            // The playhead turn's journal is quoted in full at the top of this panel beside the
            // events it claims to describe. Repeating it as the newest entry here was the one
            // passage on the page a reader met twice.
            const dropCurrent = surface.key === "journal";
            return (
              <div key={surface.key} style={{ marginTop: 22 }}>
                <div style={{ fontSize: 14, color: INK_2 }}>{zh ? surface.zh : surface.en}</div>
                <div
                  style={{
                    fontSize: 11.5,
                    color: MUTED,
                    lineHeight: 1.6,
                    margin: "2px 0 10px",
                    maxWidth: "78ch",
                  }}
                >
                  {zh ? surface.zhNote(clipped) : surface.enNote(clipped)}
                  {dropCurrent ? (
                    <>
                      {" "}
                      {zh
                        ? `第 ${turn} 回合那一則已在上方「它說在做什麼」全文引用，這裡由上一回合起。`
                        : `The turn ${turn} entry is quoted in full above, beside what actually happened; this list starts one turn earlier.`}
                    </>
                  ) : null}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: narrow ? "1fr" : "1fr 1fr",
                    gap: narrow ? 22 : 24,
                    alignItems: "start",
                  }}
                >
                  {(["north", "south"] as CivId[]).map((civ) => {
                    const all = clipped.civs[civ]?.[surface.key] ?? [];
                    const entries = dropCurrent ? all.filter((entry) => entry.turn < turn) : all;
                    return (
                      <Half
                        key={civ}
                        civ={civ}
                        entries={entries}
                        append={Boolean(surface.append)}
                        lang={lang}
                        zh={zh}
                        count={all.length}
                        empty={
                          // Everything this side has written is the entry quoted above, so the
                          // list is empty without the silence that message would imply.
                          dropCurrent && all.length > 0
                            ? zh
                              ? "在這一回合之前沒有更早的日誌。"
                              : "There is no earlier entry than the one quoted above."
                            : undefined
                        }
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}
