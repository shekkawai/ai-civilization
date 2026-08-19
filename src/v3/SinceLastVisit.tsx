import { useEffect, useState } from "react";
import { useLang } from "./lang";
import type { Landmark } from "./api";

/**
 * At roughly twelve turns an hour, the most valuable thing a returning reader can be told is what
 * changed since they last looked. The last-seen turn is kept in this browser only; nothing about a
 * reader is sent anywhere.
 */

const RULE = "#ded5c4";
const MUTED = "#8a8172";

function storageKey(seasonId: string) {
  return `v3-last-seen:${seasonId}`;
}

export function SinceLastVisit({
  seasonId,
  currentTurn,
  landmarks,
  onScrub,
}: {
  seasonId: string;
  currentTurn: number;
  landmarks: Landmark[];
  onScrub: (turn: number) => void;
}) {
  const { t, lang, landmark } = useLang();
  const [lastSeen, setLastSeen] = useState<number | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey(seasonId));
    setLastSeen(stored === null ? null : Number(stored));
    window.localStorage.setItem(storageKey(seasonId), String(currentTurn));
  }, [seasonId, currentTurn]);

  if (lastSeen === null || currentTurn <= lastSeen) return null;
  const since = landmarks.filter((mark) => mark.turn > lastSeen && mark.turn <= currentTurn).slice(0, 3);

  return (
    <div style={{ border: `1px solid ${RULE}`, padding: "8px 12px", marginTop: 12, fontSize: 13 }}>
      <span style={{ color: MUTED }}>
        {lang === "zh"
          ? `你上次看到第 ${lastSeen} 回合，現在是第 ${currentTurn} 回合。`
          : `You last saw turn ${lastSeen}; it is now turn ${currentTurn}.`}
      </span>
      {since.length > 0 ? (
        <span>
          {" "}
          {t("sinceThen")}{" "}
          {since.map((mark, index) => (
            <span key={`${mark.kind}-${mark.civ}`}>
              {index > 0 ? "、" : ""}
              <button
                onClick={() => onScrub(mark.turn)}
                style={{ border: "none", background: "none", padding: 0, cursor: "pointer", textDecoration: "underline" }}
              >
                {landmark(mark.kind)}
              </button>
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}
