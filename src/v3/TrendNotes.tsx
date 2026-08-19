import { useEffect, useState } from "react";
import { Caption } from "./RuleNote";
import { useLang } from "./lang";
import { renderModelMarkdown } from "../lib/markdown";

/**
 * Mid-season commentary from the observer model, and the season write-up when one exists.
 *
 * Both are **claims, not measurements**, so they are drawn in the same register as a civilization's
 * journal: attributed, marked verbatim, and never translated. The observer is a third model reading
 * the archive; it is not the engine and it is not a player.
 *
 * The seal runs one way and is regression-tested: the observer may read a running season, and none
 * of its text may ever reach a player's prompt. `season_trends` is not readable from the report
 * builder at all.
 */

const RULE = "#ded5c4";
const MUTED = "#8a8172";
const CLAIM_BG = "#f7f3ea";

interface TrendNote {
  seasonId: string;
  throughTurn: number;
  authorModel: string;
  writtenAt: number;
  markdown: string;
}

function Note({ note, dim }: { note: TrendNote; dim?: boolean }) {
  const { lang } = useLang();
  const zh = lang === "zh";
  return (
    <div
      style={{
        background: CLAIM_BG,
        borderLeft: `3px solid ${RULE}`,
        padding: "10px 12px",
        marginTop: 10,
        color: dim ? "#7b7365" : "#4a443c",
      }}
    >
      <div style={{ fontSize: 11, color: MUTED, marginBottom: 6 }}>
        {zh
          ? `截至第 ${note.throughTurn} 回合 · ${note.authorModel} · 原文照錄`
          : `Through turn ${note.throughTurn} · ${note.authorModel} · verbatim`}
      </div>
      <div
        style={{ fontSize: 13, lineHeight: 1.75, maxWidth: "68ch" }}
        // The observer's own markdown, escaped and link-scrubbed by `renderModelMarkdown`.
        dangerouslySetInnerHTML={{ __html: renderModelMarkdown(note.markdown) }}
      />
    </div>
  );
}

export function TrendNotes({ seasonId }: { seasonId: string }) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const [notes, setNotes] = useState<TrendNote[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/research/trends?seasonId=${encodeURIComponent(seasonId)}`, {
      headers: { Accept: "application/json" },
    })
      .then((response) => (response.ok ? response.json() : []))
      .then((payload) => {
        if (!cancelled) setNotes((payload as TrendNote[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [seasonId]);

  const [latest, ...earlier] = notes;

  return (
    <section id="trend" style={{ borderTop: `1px solid ${RULE}`, marginTop: 20, paddingTop: 16 }}>
      <div style={{ fontSize: 17, marginBottom: 2 }}>{zh ? "觀察者走勢評論" : "Observer's running commentary"}</div>
      <Caption>
        {zh
          ? "由第三個模型（觀察者）閱讀檔案後寫成，每三十分鐘檢查一次。這是評論，不是量度；它讀得到這一季，但它寫的任何一個字都永遠不會進入兩個玩家的提示。"
          : "Written by a third model — the observer — reading the archive every thirty minutes. It is commentary, not measurement. It can read the running season; none of its words ever reach either player's prompt."}
      </Caption>

      {!latest ? (
        <div style={{ fontSize: 13, color: MUTED, marginTop: 8 }}>
          {zh
            ? "這一季還沒有走勢評論。觀察者要累積足夠新回合才會寫下一則。"
            : "No commentary for this season yet. The observer waits for enough new turns before writing one."}
        </div>
      ) : (
        <>
          <Note note={latest} />
          {earlier.length > 0 ? (
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: "pointer", fontSize: 12.5, color: MUTED }}>
                {zh ? `較早的 ${earlier.length} 則` : `${earlier.length} earlier note${earlier.length === 1 ? "" : "s"}`}
              </summary>
              {earlier.map((note) => (
                <Note key={note.throughTurn} note={note} dim />
              ))}
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}
