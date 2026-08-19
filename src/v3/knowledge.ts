import { RULES, SIGHT } from "../sim/config";
import type { BuildingFunction, Frame } from "../sim/types";
import type { Lang } from "./lang";

const JOB_TEXT: Record<Frame["workers"][number]["job"]["kind"], Record<Lang, string>> = {
  idle: { zh: "閒置", en: "idle" },
  move: { zh: "移動", en: "walking" },
  gather: { zh: "採集", en: "gathering" },
  deposit: { zh: "卸貨", en: "depositing" },
  build: { zh: "建造", en: "building" },
  repair: { zh: "修補", en: "repairing" },
  remove: { zh: "拆解", en: "removing" },
};

export function foreignWorkerObservation(
  worker: Frame["workers"][number],
  visibleNow: boolean,
  lang: Lang,
) {
  if (!visibleNow) {
    return lang === "zh"
      ? "這個人目前不在可見範圍。這個文明沒有持續追蹤其位置、工作或背包。"
      : "This person is not currently visible. The civilization does not keep tracking their position, activity or backpack.";
  }
  const job = JOB_TEXT[worker.job.kind][lang];
  return lang === "zh"
    ? `在 (${worker.x}, ${worker.z}) 見到一個人。身份不明；表面正在${job}。背包有糧食 ${worker.carrying.food}、石材 ${worker.carrying.stone}。`
    : `A person is visible at (${worker.x}, ${worker.z}). Their identity is unknown; their apparent activity is ${job}. Their backpack holds ${worker.carrying.food} food and ${worker.carrying.stone} stone.`;
}

export function buildingFunctionNote(fn: BuildingFunction, protocolVersion: number, lang: Lang) {
  if (fn === "hall") {
    const storage =
      lang === "zh"
        ? `糧食與石材在這座建築內共用 ${RULES.hallStorageCapacity} 格容量。每方只有一座，不能再建。`
        : `Food and stone share ${RULES.hallStorageCapacity} spaces inside this structure. One per side, and a second cannot be built.`;
    if (protocolVersion < 15) return storage;
    return lang === "zh"
      ? `${storage} 這座已完成建築仍然站立的方塊亦計入全城人口容量。`
      : `${storage} Its standing cells also count toward settlement-wide capacity while this structure is complete.`;
  }

  if (fn === "post") {
    if (protocolVersion >= 15) {
      return lang === "zh"
        ? `觀察用途：持續提供 ${SIGHT.post} 格視野，沒有儲存，也不會延伸建築範圍。它沒有獨立人口加成；但作為已完成建築，仍然站立的方塊會按全城公式計入人口容量。`
        : `Observation function: it continuously sees ${SIGHT.post} tiles, adds no storage and does not extend build range. It has no separate worker-place bonus, but its standing cells count under the settlement-wide capacity formula while complete.`;
    }
    return lang === "zh"
      ? `純觀察用途：持續提供 ${SIGHT.post} 格視野，沒有儲存或人口位置，也不會延伸建築範圍。`
      : `Observation only: it continuously sees ${SIGHT.post} tiles, adds no storage or worker places, and does not extend build range.`;
  }

  const storage =
    lang === "zh"
      ? `每個仍然站立的方塊增加 ${RULES.storeStoragePerBlock} 格容量，拆一塊即刻少一塊。`
      : `Each block still standing adds ${RULES.storeStoragePerBlock} spaces, and taking one apart costs that capacity at once.`;
  if (protocolVersion >= 15) {
    return lang === "zh"
      ? `${storage} 倉庫沒有獨立人口加成；但作為已完成建築，仍然站立的方塊會按全城公式計入人口容量。未完成的工地甚麼都不提供。`
      : `${storage} A Store has no separate worker-place bonus, but its standing cells count under the settlement-wide capacity formula while complete. An unfinished worksite contributes nothing.`;
  }
  if (protocolVersion >= 10) {
    return lang === "zh"
      ? `${storage} 這一季人口位置固定為 ${RULES.naturalCeiling}；倉庫不增加人口位置。未完成的工地甚麼都不提供。`
      : `${storage} Worker places are fixed at ${RULES.naturalCeiling} in this season; a Store adds none. An unfinished worksite contributes nothing.`;
  }
  if (protocolVersion >= 4) {
    return lang === "zh"
      ? `${storage} 完成後，每 ${RULES.storeBlocksPerWorkerSlot} 個設計方塊增加一個人口位置。未完成的工地甚麼都不提供。`
      : `${storage} Once complete, every ${RULES.storeBlocksPerWorkerSlot} design cells add one worker place. An unfinished worksite contributes nothing.`;
  }
  return lang === "zh"
    ? `${storage} 完成後增加兩個人口位置；未完成的工地甚麼都不提供。`
    : `${storage} Once complete it adds two worker places. An unfinished worksite contributes nothing.`;
}
