import { scriptedDecisions } from "./agents";
import { advance, createWorld, type Decide } from "./engine";
import { captureFrame } from "./frames";
import type { Frame, World } from "./types";

export interface Session {
  world: World;
  frames: Frame[];
}

export function startSession(seed = 20260802): Session {
  const world = createWorld(seed);
  return { world, frames: [captureFrame(world, [])] };
}

export function stepSession(session: Session, turns = 1, decide: Decide = scriptedDecisions) {
  for (let step = 0; step < turns; step += 1) {
    const events = advance(session.world, decide);
    session.frames.push(captureFrame(session.world, events));
  }
  return session;
}

export type { Decide, Frame };
