import { useEffect, useMemo, useState } from "react";
import { api, type SeasonMessage } from "./api";
import { CIV_COLOUR } from "./BeliefMap";
import { Caption } from "./RuleNote";
import { civLabel, useLang } from "./lang";
import { useNarrow } from "./responsive";
import type { CivId } from "../sim/types";

/**
 * The letters, in full.
 *
 * `message` is the only action in the engine that moves anything between the two civilizations, and
 * what it moves is words — there is no trade, no gift and no transfer of goods. So a page that
 * showed a "first message" tick on the landmark rail and nothing else was hiding the entire
 * diplomatic record. v30's two sides wrote 82 letters and spent forty turns agreeing to a barter
 * that no action in this engine can perform; reading that requires the text.
 *
 * A letter is **in-world speech, not a measurement**. It is drawn in the claim register, verbatim,
 * never translated, and it sits beside the turn number so a reader can scrub to what was actually
 * happening when it was written. A model may lie here. That is the point of showing it.
 */

const RULE = "#ded5c4";
const MUTED = "#8a8172";
const CLAIM_BG = "#f7f3ea";

/** How many turns of silence before the correspondence is described as having lapsed. */
const QUIET_TURNS = 3;

function Letter({ message, narrow }: { message: SeasonMessage; narrow: boolean }) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const mine = message.from === "north";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: narrow || mine ? "flex-start" : "flex-end",
        marginTop: 8,
      }}
    >
      <div
        style={{
          maxWidth: narrow ? "100%" : "60ch",
          background: CLAIM_BG,
          borderLeft: `3px solid ${CIV_COLOUR[message.from]}`,
          padding: "8px 12px",
        }}
      >
        <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>
          <span style={{ color: CIV_COLOUR[message.from] }}>{civLabel(message.from, lang)}</span>
          {zh
            ? ` · 第 ${message.sentTurn} 回合寄出 · 第 ${message.deliverTurn} 回合送達 · 原文照錄`
            : ` · sent turn ${message.sentTurn} · delivered turn ${message.deliverTurn} · verbatim`}
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.75, color: "#4a443c", whiteSpace: "pre-wrap" }}>
          {message.text}
        </div>
      </div>
    </div>
  );
}

export function Correspondence({ seasonId, turn, protocolVersion }: { seasonId: string; turn: number; protocolVersion: number }) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const narrow = useNarrow();
  const [messages, setMessages] = useState<SeasonMessage[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let live = true;
    api.messages(seasonId, turn).then((list) => {
      if (live) setMessages(list ?? []);
    });
    return () => {
      live = false;
    };
  }, [seasonId, turn]);

  const counts = useMemo(() => {
    const sent: Record<CivId, number> = { north: 0, south: 0 };
    for (const message of messages) sent[message.from] += 1;
    return sent;
  }, [messages]);

  const last = messages.at(-1);
  const silence = last ? turn - last.sentTurn : 0;

  // A long exchange read newest-first is a wall; the opening letters and the current state of the
  // conversation are what a reader wants, so the middle collapses until asked for.
  const shown = expanded || messages.length <= 8 ? messages : [...messages.slice(0, 2), ...messages.slice(-6)];
  const hidden = messages.length - shown.length;

  return (
    <section style={{ borderTop: `1px solid ${RULE}`, marginTop: 20, paddingTop: 16 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.08em", color: MUTED, textTransform: "uppercase", marginBottom: 8 }}>
        {zh ? "兩方之間的信" : "Letters between the two"}
      </div>
      <Caption>
        {protocolVersion >= 17
          ? zh
            ? "信裡說的是模型自己的話，可能是真話，也可能不是。Protocol 17 另有一個中性物理動作：工人可把物資放在腳下，任何之後站上該格的人都可能拾走；它沒有收件人，也不保證交換。"
            : "A letter is the model's own claim and may not be true. Protocol 17 adds one neutral physical action: a person may set goods at their feet, and anybody who later stands there may collect them. It has no recipient and guarantees no exchange."
          : zh
            ? "傳話是這個世界裡唯一能在兩個文明之間傳遞的東西——沒有交易、沒有贈與、沒有任何搬運貨物給對方的動作。信裡說的是模型自己的話，可能是真話，也可能不是。"
            : "A message is the only thing that passes between the two civilizations in this world — there is no trade action, no gift, no way to hand goods to the other side. What a letter says is the model's own claim, and it may not be true."}
      </Caption>

      {messages.length === 0 ? (
        <div style={{ fontSize: 13, color: MUTED, marginTop: 8 }}>
          {zh ? "到這一回合為止，雙方沒有傳過話。" : "No letter had been sent by this turn."}
        </div>
      ) : (
        <>
          <div style={{ fontSize: 13, color: "#4a443c", marginTop: 8, lineHeight: 1.7 }}>
            {zh
              ? `到第 ${turn} 回合為止共 ${messages.length} 封：${civLabel("north", lang)} ${counts.north} 封、${civLabel("south", lang)} ${counts.south} 封。`
              : `${messages.length} letters through turn ${turn}: ${counts.north} from ${civLabel("north", lang)}, ${counts.south} from ${civLabel("south", lang)}.`}
            {last && silence >= QUIET_TURNS ? (
              <span style={{ color: MUTED }}>
                {zh
                  ? ` 最後一封在第 ${last.sentTurn} 回合，之後 ${silence} 個回合沒有人再寫。`
                  : ` The last was turn ${last.sentTurn}; nobody has written in the ${silence} turns since.`}
              </span>
            ) : null}
          </div>

          {shown.map((message, index) => (
            <div key={message.id}>
              {hidden > 0 && index === 2 ? (
                <button
                  onClick={() => setExpanded(true)}
                  style={{
                    marginTop: 10,
                    border: `1px solid ${RULE}`,
                    background: "transparent",
                    color: MUTED,
                    fontFamily: "inherit",
                    fontSize: 12,
                    padding: "4px 10px",
                    cursor: "pointer",
                  }}
                >
                  {zh ? `展開中間 ${hidden} 封` : `Show the ${hidden} letters in between`}
                </button>
              ) : null}
              <Letter message={message} narrow={narrow} />
            </div>
          ))}
        </>
      )}
    </section>
  );
}
