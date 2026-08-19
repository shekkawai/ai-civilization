export type CivId = "north" | "south";
export type Resource = "food" | "stone";
export type Terrain = "grass" | "field" | "oasis" | "stone" | "water" | "ridge";
export type BuildingFunction = "hall" | "store" | "post";
export type Knowledge = 0 | 1 | 2;

export interface Point {
  x: number;
  z: number;
}

export interface Stock {
  food: number;
  stone: number;
}

export interface Node {
  kind: Resource;
  amount: number;
  cap: number;
  regen: number;
  pool?: string;
}

export interface OasisPool {
  id: string;
  cells: Point[];
  amount: number;
  cap: number;
  regen: number;
}

export interface SharedStonePool extends OasisPool {}

export interface Tile {
  terrain: Terrain;
  node?: Node;
}

export interface TileObservation {
  turn: number;
  terrain: Terrain;
  node?: { kind: Resource; amount: number; cap: number; regen: number; pool?: string };
  building?: {
    id: string;
    owner: CivId;
  };
  pile?: Stock;
}

export interface Design {
  id: string;
  name: string;
  fn: BuildingFunction;
  author: CivId | "system";
  rows: string[];
}

export interface Building {
  id: string;
  owner: CivId;
  designId: string;
  fn: BuildingFunction;
  origin: Point;
  cells: Point[];
  access: Point[];
  total: number;
  /** One entry per design cell: 1 when that physical block exists, 0 otherwise. */
  blocks: number[];
  placed: number;
  removed: number;
  delivered: number;
  stock: Stock;
  createdTurn: number;
  completedTurn?: number;
}

export type Job =
  | { kind: "idle" }
  | { kind: "move"; to: Point }
  | { kind: "deposit" }
  | { kind: "gather"; at: Point }
  | { kind: "build"; buildingId: string }
  | { kind: "repair"; buildingId: string }
  | { kind: "remove"; buildingId: string; adjacentSince?: number };

export interface Worker {
  id: string;
  owner: CivId;
  at: Point;
  carrying: Stock;
  job: Job;
  alive: boolean;
}

export interface Pile {
  id: string;
  at: Point;
  stock: Stock;
  turn: number;
  /**
   * Protocol 17. The worker that set this pile down. This prevents immediate automatic pickup;
   * protocol 21 clears it once that worker leaves, allowing a later return to recover the pile.
   */
  droppedBy?: string;
}

export interface Contact {
  firstTurn: number;
  lastSeenTurn: number;
  name?: string;
}

export interface ForeignSeen {
  workers: Record<string, number>;
  buildings: Record<string, number>;
  nextWorker: number;
  nextBuilding: number;
}

export interface Civ {
  id: CivId;
  label: string;
  spawn: Point;
  designs: Record<string, Design>;
  knowledge: Uint8Array;
  lastSeen: Int32Array;
  memory: Array<TileObservation | null>;
  contacts: Partial<Record<CivId, Contact>>;
  foreignSeen: ForeignSeen;
  notes: string;
  standingOrders: string;
  chronicle: string[];
  journal: Array<{ turn: number; text: string }>;
  /** Protocol 11: consecutive turns whose full food upkeep was paid. */
  fullyFedTurns?: number;
}

export type Action =
  | { type: "design"; design: Design }
  | { type: "build"; designId: string; at: Point; workers: string[] }
  | { type: "gather"; workers: string[]; at: Point }
  | { type: "deposit"; workers: string[] }
  /** Protocol 17. Amounts are optional; omitting both sets down everything carried. */
  | { type: "drop"; workers: string[]; food?: number; stone?: number }
  | { type: "move"; workers: string[]; to: Point }
  | { type: "remove"; workers: string[]; buildingId: string }
  | { type: "repair"; workers: string[]; buildingId: string }
  | { type: "note"; text: string }
  | { type: "name"; civ: CivId; name: string }
  | { type: "message"; civ: CivId; text: string };

export interface Decision {
  civ: CivId;
  journal: string;
  standingOrders?: string;
  chronicleLine?: string;
  actions: Action[];
}

export type ActionResultStatus = "accepted" | "rejected" | "completed" | "failed" | "no-op";

export interface ActionResult {
  id: number;
  turn: number;
  civ: CivId;
  actionIndex: number;
  actionType: Action["type"] | "decision" | "job";
  status: ActionResultStatus;
  code: string;
  text: string;
  at?: Point;
  workerIds?: string[];
  targetId?: string;
  amount?: number;
}

export type EventKind =
  | "world"
  | "design"
  | "build"
  | "complete"
  | "gather"
  | "deposit"
  | "drop"
  | "removal"
  | "repair"
  | "contact"
  | "message"
  | "spill"
  | "migration"
  | "departure"
  | "starve"
  | "upkeep"
  | "failure";

export interface SimEvent {
  id: number;
  turn: number;
  civ?: CivId;
  kind: EventKind;
  text: string;
  at?: Point;
}

export interface World {
  protocolVersion?: number;
  seed: number;
  turn: number;
  width: number;
  height: number;
  tiles: Tile[];
  /** Protocol 14: every Oasis footprint cell reads and draws this one shared food pool. */
  oasis?: OasisPool;
  /** Protocol 15: every marked central stone cell withdraws from this one finite pool. */
  sharedStone?: SharedStonePool;
  civs: Record<CivId, Civ>;
  workers: Record<string, Worker>;
  buildings: Record<string, Building>;
  piles: Record<string, Pile>;
  events: SimEvent[];
  actionResults: ActionResult[];
  nextEvent: number;
  nextResult: number;
  nextBuilding: Record<CivId, number>;
  nextWorker: Record<CivId, number>;
  nextPile: number;
  messages: Array<{ id: number; sentTurn: number; deliverTurn: number; from: CivId; to: CivId; text: string }>;
  nextMessage: number;
  preparedTurn?: number;
  turnPreparation?: {
    turn: number;
    upkeep: Record<
      CivId,
      {
        workersBefore: number;
        foodDue: number;
        foodPaid: number;
        starved: number;
        structureStoneDue: number;
        structureStonePaid: number;
        structureBlocksLost: number;
      }
    >;
  };
  tally: Record<CivId, { blocksLaid: number; blocksTakenFromOthers: number; blocksLost: number }>;
}

export interface CivFrame {
  food: number;
  stone: number;
  workers: number;
  buildings: number;
  carried: number;
  blocksPlaced: number;
  blocksTaken: number;
  quarryLeft: number;
  contact: boolean;
  storageUsed?: number;
  storageCapacity?: number;
  nextMigrationTurn?: number;
  migrationFoodRequired?: number;
  /** Tiles this civilization has ever seen — the knowledge-growth series. */
  seenTiles?: number;
  /**
   * Chebyshev distance between the two civilizations' nearest living workers, or undefined when
   * either side has none left. Symmetric, so both rows carry the same value; kept per civ so the
   * series survives one side dying.
   */
  nearestGap?: number;
}

export interface Frame {
  turn: number;
  civs: Record<CivId, CivFrame>;
  workers: Array<{
    id: string;
    owner: CivId;
    x: number;
    z: number;
    job: Job;
    carrying: Stock;
    destination?: { x: number; z: number; label: string };
  }>;
  buildings: Array<{
    id: string;
    owner: CivId;
    fn: BuildingFunction;
    designId: string;
    name: string;
    cells: Point[];
    blocks: number[];
    placed: number;
    total: number;
    removed: number;
    stock: Stock;
    storageCapacity?: number;
    workerPlaces?: number;
    complete: boolean;
  }>;
  piles: Array<{ id: string; x: number; z: number; stock: Stock; turn: number }>;
  nodes: Array<{ x: number; z: number; amount: number }>;
  observedNodes: Record<CivId, Array<{ x: number; z: number; amount: number; turn: number }>>;
  observedBlocks: Record<
    CivId,
    Array<{ x: number; z: number; id: string; owner: CivId; turn: number }>
  >;
  observedBuildings: Record<
    CivId,
    Array<{
      id: string;
      owner: CivId;
      oldestObservationTurn: number;
      newestObservationTurn: number;
      visibleCells: number;
      rememberedCells: number;
      cells: Point[];
    }>
  >;
  observedPiles: Record<CivId, Array<{ id: string; x: number; z: number; stock: Stock; turn: number }>>;
  fog: Record<CivId, Uint8Array>;
  /**
   * Per tile, the turn this civilization last laid eyes on it; -1 for never. Fog is drawn as age
   * rather than as a binary, so the viewer can tell a tile seen last turn from one seen forty
   * turns ago. A plain number array because a typed array does not survive JSON as one.
   */
  lastSeen: Record<CivId, number[]>;
  events: SimEvent[];
  journal: Record<CivId, string>;
}
