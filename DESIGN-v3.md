# Spectator UI v3 — design contract

Status: **production spectator**, agreed with Shek on 2026-08-06 and promoted on
2026-08-09 after checking live v26 against the research API and SQLite. It owns `/`;
`/v3` remains an alias and the previous spectator is temporarily recoverable at `/legacy`.

This document was written from the engine, the protocol, the map and the SQLite
schema only. The previous UI was deliberately not read while designing it, so
that v3 is a redesign rather than a refactor.

---

## 1. Thesis

The experiment is about **decisions made under incomplete information**. An
omniscient default view makes the reader smarter than both players and destroys
the thing being observed. So:

> The primary control is not a tab bar. It is a belief switch:
> **北岸所信 / 南原所信 / 事實**.

Everything else follows from that.

Two supporting rules, both non-negotiable:

- **Engine fact and model claim never blend.** Journals, standing orders,
  notebooks and chronicles are the model's own words and are always rendered in
  a visually distinct register. A model writing "派三人去採石" while its orders
  sent them to a farm is one of the most valuable findings this site can
  surface, and it is only visible if the two are never merged.
- **Numbers the models cannot see are marked** with a lock (🔒). Regrowth rate,
  the migration threshold, the other side's stores — the models are told none of
  these. Marking them is how the blindfold becomes visible.

## 2. What v3 refuses to be

- No dark command-centre chrome. This is an instrument and a document: warm
  paper, ink, hairlines.
- No score, no leaderboard, no ranking. The rules define no victory condition;
  a scoreboard tells the human a competition story the models are deliberately
  never told.
- Nothing floating over the map.
- No animation implying causality the engine does not have.
- No live-theatre pretence. ~12 turns an hour. The page should feel like a slow
  instrument and should say plainly when the next turn lands — and say plainly
  when the season is paused.

## 3. There is no live mode and no replay mode

There is a **playhead**. On the newest turn you are live; drag it back and you
are in replay. Same page, same components, one control.

- A new turn arriving while you read **never moves the view**. A quiet strip
  appears: `第 48 回合已到 · 跳到最新`. Click it or ignore it.
- The clock is honest: `第 47 回合 · 下一回合約 3 分 12 秒後`, or
  `本季已暫停於第 23 回合` when the season is paused.
- Poll every ~20–30s. Never auto-scroll, never auto-jump.

### The scrub bar is a story, not a slider

`world_events` already carries every landmark keyed by turn. The bar shows ~8
ticks: first structure completed, first adult joined, first sighting of the
other side, first starvation, first contact, quarry exhausted. Those marks are
the reason anyone scrubs.

Step-by-turn with `←` / `→` is the primary interaction; auto-play (2× / 8×) is
secondary, because turns are discrete and each one means something.

### One playhead crosses everything

A single vertical line runs through the map's turn, every chart, and the turn
card simultaneously. Scrub and they all move together. This is what turns seven
small charts into one instrument instead of seven widgets.

## 4. Presenting the machinery

The rule: **never show a formula as a formula — show it as a ledger of what just
happened, with the formula one tap away.** Derived numbers appear only when they
change something or block something. There is no permanent stat tile reading
`容量 150`.

Four layers, each optional:

**Layer 0 — one sentence per civ per turn.**
`北岸 6 人吃掉 6 糧，倉存剩 41；今回合沒有人加入。`

**Layer 1 — every number as before → change → after, never a bare value.**
`糧食 47 −6 上繳 +15 採集 −15 遷入 = 41`, deltas signed. Writing `−6（6人 × 1）`
teaches the upkeep rule silently, with the civ's own numbers.

**Layer 2 — the gate checklist.** The confusing systems are conditionals, so
render the conditions live with this civ's actual figures and let the reader
learn the rule by watching it fail:

```
成年人加入 — 第 24 回合
✓ 逢雙數回合
✓ 有位置          6 / 8
✗ 糧食足夠        需要 50（15 + 7人×5回合），現有 41
✓ 聚居地旁有空地
→ 沒有人加入
```

Same treatment for storage (`容量 150 = 聚居地 150 + 倉庫 0×10`, surfaced only
when a deposit is refused), build cost (`需要 60 石 = 20 格 × 3，已運到 15`) and
regrowth (`每回合 +3 🔒，上限 120，被方塊壓住則停止`). All of these already exist
in the engine as structured refusal codes — surface them verbatim rather than
re-deriving them.

**Layer 3 — definition on tap.** Any term (糧倉 / 位置 / 再生 / 上繳) opens a
footnote with the exact constant, and whether the models are told it.

Farm regrowth does **not** belong in a table. It is tile saturation on the map
(`amount / cap`) plus exactly one chart: harvested this turn vs regrown this
turn. Nobody cares that it is +3; they care the moment harvest crosses above
regrowth.

## 5. Charts

Small multiples, ~80px tall, stacked, shared turn axis, north solid / south
dashed, the same two colours everywhere in the app. Sourced from `turn_stats` —
one small query for a whole season.

Default three:

1. 人口 (stepped)
2. 存糧, **with the migration threshold as a second dashed line** — it rises
   with population, so the reader watches the bar move away from them. That one
   chart teaches the birth rule with no words at all.
3. 已見過的地 — knowledge growth, the truest proxy for "the civilization is
   growing"

Behind one 更多 expander:

4. 存石
5. 地上糧食 vs 本回合採集
6. 方塊數
7. 兩方最近工人距離 — a flat line is the v13 finding, visible at a glance

## 6. The map

One map, with **北岸所信 / 南原所信 / 事實** as its lens. It keeps the same size,
position and orientation while the lens changes, so the viewer compares the
same place without duplicated maps or eye travel. The omniscient turn, gap,
contact and season status sit in one horizontal strip above it.

- **Fog is drawn as age, not as a binary.** Visible now is full colour;
  remembered is bleached in proportion to turns since `lastSeen`; never-seen is
  paper, not black — absence rather than darkness.
- One toggle outlines **truth on top of belief** in hairline. Everything that
  exists but is not known draws as an empty outline. That single control answers
  "does it know?" for the whole map at once.
- During replay, recently placed blocks glow and settle over a few turns, and
  newly-seen tiles flash once. Scrubbing then reads as a wave of construction
  and a widening circle of knowledge.

### The gap gauge is a z-axis swarm, not a number

A thin vertical strip, z=0 at top to z=95 at bottom, every worker a dot. The gap
is the whitespace between the two clumps. Mark the ridge at z=33–34 with its
three passes and the central farmland belt. v13's "frozen at 68 tiles for 30
turns" becomes two clumps that visibly never move, which reads instantly where
`68` does not.

## 7. Clicking anything

`worker.job` is **persistent**, not per-turn — a worker keeps its job until the
model gives it a new one. So "what it is going to do" is a stored fact, not a
guess.

The worker inspector, four layers, strictly separated:

1. **狀態 (fact)** — 位置、背 12 糧 / 0 石（上限 30）、存活。
2. **現行指令 (fact — the standing job)** — `前往 (61,44)`, plus what is
   derivable: `還差 14 格（每回合最多走 4 格）`. For a gather job, the target
   tile's remaining amount and whether it regrows. For a build job,
   `已放 8 / 20 格，工地欠 36 石`. **And an idle counter** — `閒置 12 回合`. That
   counter alone would have made v15's four stranded workers obvious on sight.
3. **本回合發生了什麼 (fact)** — from `action_results`, which carries
   `workerIds`, so per-worker attribution is exact.
4. **模型怎麼說 (claim — different register)** — the action that assigned the
   job, its index, the turn it was issued, that turn's journal line, and the
   relevant standing order.

**意圖線 (intent lines).** When a worker is selected, draw a hairline to its job
target. One toggle draws every worker's line at once: the civ's entire intent
becomes a fan of lines, readable in a second. Six lines converging on one farm
tile while the granary sits empty is a strategy you can *see*. This is the best
single feature for reading the model's planning — better than any text panel.

**Clicking obeys the belief switch.** In 北岸所信, clicking a currently visible *south* worker
shows exactly what north's private report contains: position, apparent activity and carried food
and stone, but no identity. Once that person leaves sight, the inspector reveals none of their
current position, activity or backpack. Flip to 事實 for the full record and identity.

**Tiles too**, same inspector: `糧食 96 / 120`、`每回合 +3 🔒`、
`被方塊壓住時停止再生`、`北岸第 31 回合見過，南原從未見過`.

**One selection state, shared by every view.** Select a worker and it highlights
everywhere: the dot on both belief maps, its lane in the Loom, its row in the
turn card.

### The honest limit

There is **no per-worker multi-turn plan in the data.** The only forward-looking
text is civ-level: standing orders and the journal. The inspector may show a
worker's current order and where it came from — one step deep — and link up to
the civ's stated plan. It must never stitch those into a fake itinerary such as
"next it will go to the quarry".

## 8. The Worker Loom

Six to eighteen workers is few enough to name. Each worker gets a horizontal
lane across the whole season, coloured by what it did that turn: walking,
gathering, hauling, depositing, building, removing, idle. Eighteen lanes across
150 turns is a complete portrait of an economy. v14's collapse is a wall of
gather-green with no deposits; v12's two sealed workers are two lanes that go
flat at turn 6 and never change. All of it is already in `action_results`, keyed
by worker id.

## 9. The turn card has a fixed grammar

The engine's order never varies:

```
upkeep → regrowth → orders → movement → carrying → gathering →
construction → removal/repair → migration check
```

Render that as the spine of the turn card, always in the same order, stages
empty or filled. A reader learns the shape once and then reads any turn at a
glance.

**Refusals get equal billing with successes.** Each side shows "asked for and
did not get", in the engine's own words, with a repeat counter when the same
code recurs. Today that is the most informative data in the system and the least
visible.

**Journal, orders and results share one row** — what the model said it was
doing, what it asked for, what actually happened. A model writing "糧倉充足"
beside a stored-food line falling to 1 should take one glance, not two tabs.

## 10. Coming back tomorrow

At ~12 turns an hour the highest-value feature is *what changed since I last
looked*. Store the last-seen turn locally and show a band on arrival:

> 你上次看到第 31 回合。之後：北岸完成倉庫、南原第一次見到對方的人、存糧由 88 跌到 41。

Three bullets, generated from the same event marks as the timeline.

## 11. Page order

1. status line — season, which model on which seat, turn, when the next one lands
2. gap swarm
3. one map with north-belief / south-belief / truth lenses
4. inspector, as a sibling below them, never floating
5. resource bars — one bar per resource in three segments: **stored / in
   backpacks / on the ground**, against the aggregate capacity of the civilization's
   physical storage structures, with a tick at
   next turn's upkeep and a tick at the migration threshold. When the backpack
   segment grows while stored stays flat, the reader sees v14's deposit deadlock
   without being told it exists.
6. this turn's spine
7. the Loom
8. charts
9. trajectories on one left-to-right axis, north solid, south dashed
10. raw prompt / response archive, untranslated

## 12. Bilingual

EN and ZH both stay. This constrains layout: Chinese runs ~40% narrower, so
labels go **above** numbers, never beside them, and no component may size itself
to its text. The layer-0 sentence is a per-language template with slotted
numbers, never string concatenation — otherwise the English reads like a robot.

**One exception, below 640px only.** A stacked label costs 34px of height and
there are nine of them above the map, which is how the map ended up below the
fold on the one screen where it is hardest to read. In the compact form the label
sits beside its number, each pair is `white-space: nowrap`, and the row wraps
between pairs — so the pair can never be split and the layout still does not size
itself to its text. Nothing else adopts this: it is a vertical-budget decision,
not a change of register.

## 13. Build and review process

- The UI was built under **`/v3` in new files** so it could be audited beside the previous page.
  It became the production `/` route on 2026-08-09; `/v3` remains an alias and `/legacy` is a
  rollback route while the replacement settles.
- Development runs against a **finished** season pinned by URL
  (`/v3?season=deepseek-sonnet-shadow-20260804-v13`). v13 is aborted at 152
  turns and never changes, so it is a deterministic fixture without copying
  377 MB of world JSON. Live data is wired last.
- Promotion does not change the engine, active season or research ledger; it changes only the
  frontend route. The old page stays isolated at `/legacy` until a later explicit cleanup.

### Eighth pass (2026-08-11) — local storage and protocol-honest carrying

- Clicking a completed Hall or Store uses the backpack's visual grammar to show that structure's
  exact food, stone and empty spaces. Large stores group cells proportionally so a 200-space Hall
  remains legible, while the three numeric totals stay exact. The civilization bars remain an
  aggregate comparison only; they are never presented as one remote inventory.
- Carrying prose now reads `protocolVersion`. Protocol 17 replays still say that changing resource
  kind forces an unload; Protocol 18 says a partial mixed load may continue Foodland A → Foodland B
  → stone when the model assigns each next target. A depleted source creates no invisible route:
  without a replacement order, the standing job heads toward physical storage.
- The same audit removed two stale population claims. From Protocol 15 onward, a Hall inspector and
  the home-limits card state settlement-wide capacity as floor(all standing blocks in completed
  owned structures ÷ 3); Store and Post notes now say their completed standing blocks participate
  in that same formula even though neither has a separate worker-place bonus. Older seasons retain
  their historical fixed-place or Store-supplied wording.
- A civilization lens now mirrors the model report for people visible now: identity stays hidden,
  while apparent activity and exact food/stone carried are shown. When the person leaves sight, the
  inspector hides current position, activity and load instead of leaking the truth frame.

### Seventh pass (2026-08-08) — the phone, and prose on demand

Shek read the page on a phone. Three findings, all structural rather than cosmetic.

**1. The map could not be enlarged by touch.** There was no pinch, so on a phone the only way to
zoom was the 24px `+` button — and at fit scale a person is a three-pixel dot, so a reader who
cannot zoom cannot read the map at all. `BeliefMap` now tracks every live pointer: one is a pan, two
are a pinch about their midpoint, a stationary press-and-release is a tap that selects, and two taps
in the same place enlarge about that place. `touchAction: none` on the canvas is what hands us the
second finger instead of letting the browser zoom the page. Map buttons grow to 34px under
`(pointer: coarse)` and the hint line names the gesture the reader actually has. Verified through
CDP `Input.dispatchTouchEvent` against the running page: 2.6× → 11.8× pinching out, → 1.7× pinching
in, 1.9× on a double tap, a drag pans without scrolling the page, and a tap opens the tile's record.

**2. The map opened on nine tenths blank paper.** A whole-world fit is honest only if the world is
full, and at turn 100 a civilization has seen a blob about thirty tiles across. `frameKnown()` opens
on what the selected lens actually knows — computed from that lens's own fog, **never** from truth,
because a camera aimed by the world would silently point at the other civilization. It runs on first
draw, on resize, and on a lens change, and stops running the moment the reader aims the camera
themselves.

**3. Below the map the page was 12,000 pixels of continuous scroll.** Fourteen sections, no way to
tell where you were or what was still coming. They are now grouped by the question they answer —
**this turn / the season / the two models / what they said / the rules** — with a sticky switcher,
and every panel stays mounted behind `display: none` so switching never refetches a season. Nothing
was removed. 12,000px → ~4,200px on a phone.

Alongside those:

- **`Note` — prose that is available rather than present.** Every paragraph on this page earns its
  place by being true, and there were enough of them that a phone screen was mostly justification.
  The prose is not the problem; printing all of it unasked is. A `<details>` with a handle that says
  what the explanation is about, so the default view is figures. The `Explain` switch still governs
  whether explanations exist at all; it now governs whether they are *offered* rather than *printed*.
- **The map legend folds**, and on a wide screen it moves into the inspector's column — which was
  380 × 760 of blank paper beside the densest surface on the page while the key to that surface sat
  below the fold.
- **`Efficiency` restructures rather than scrolls.** A 560px table on a 390px screen scrolls
  sideways, and a reader who does not discover that sees only the first civilization — on the one
  section built to compare two. Below the breakpoint each reading becomes a block with the pair drawn
  as two bars on that reading's own shared scale. The bars carry magnitude only, so the direction is
  named beside them (`lower is better`): 8.9% idle draws a longer bar than 3.7% idle. Still no
  composite, no rank, no winner.
- **Layer switches moved against the map.** 「真相輪廓」 and 「意圖線」 draw on the map and nothing
  else; from the masthead they were two of the four chips pushing the map below the fold.
- **Overflow bugs the page's `overflow-x: clip` had been hiding**: an SVG's 300px intrinsic width
  overrunning a `flex: 1` track (the effort bands, drawn off the right edge), a chart header whose
  last reading was cut off, a 132px stage-label column eating a third of the width, and two bar ticks
  printing their labels through one another.

### Second pass (2026-08-07) — sans, the header block, structures, and the two missing sections

- **Sans-serif throughout**, Shek's call. The paper palette carries the "instrument" feel on its
  own; the serif was costing legibility on the dense figure rows and on Traditional Chinese at
  11–13px, where Songti's thin strokes disappear. One `fontFamily` in `page.tsx`'s `Shell`.
- **The header block above the map was broken, and it was a layout fault, not bad text.** The turn
  gutter ran the full 1180px while the view header was centred with the map, so on a wide screen the
  two rows started ~190px apart with a fixed `min-height: 112px` of reserved emptiness between them.
  Both now sit inside the map's own column, flush with its left edge, and flow naturally. `TruthHeader`
  also gives 事實 its own line: sharing a wrapping flex row put it beside north and dropped south to a
  second row, drawing the two sides — which exist to be compared — in different registers.
- **Clicking a structure now reads like the earlier design.** `StructureCard` in `Inspector.tsx`
  gives function, footprint, standing-versus-total, cells taken apart, stone still owed, stored
  goods in that physical structure, the season-correct settlement capacity, sight, and the removal arithmetic. **Standing and
  `placed` are different numbers and both are printed**: `placed` counts cells ever laid, `standing`
  counts cells still there, so a structure reading `20 / 20 placed` with eight blocks gone has been
  taken apart — the single event this whole simulation exists to catch. Foreign structures still
  reveal only observed cells and never a function.
- **`TrendNotes.tsx`** brings the observer's 觀察者走勢評論 to v3, in the same claim register as a
  journal: attributed, marked verbatim, never translated, latest first with earlier notes behind a
  `<details>`.
- **`Rules.tsx`** is the full rule set for human visitors, in six collapsible groups, with every
  number read from `config.ts` — never typed into the prose. The 🔒 lines are the point of it: they
  separate what a model is told from what it must work out. It states plainly that `remove` is the
  only relevant verb, that no model is ever told it works on someone else's blocks, and that whether
  one works it out is the thing being measured.

### Sixth pass (2026-08-07) — is one model actually planning better?

Shek's reading: *"the viewer wants to know which model is smarter — e.g. is a worker's backpack full
when it moves, or often empty and wasting turns, is it always idle? First analyse the existing
gameplay data and decide what metrics count as efficiency."*

The metrics were chosen by querying every recorded season first. What the ledgers actually showed,
across the five longest runs (v11, v13, v18, v19, v21):

| reading | what it separated |
| --- | --- |
| delivered per worker-turn | 1.01–1.19 against 1.27–1.59; the higher side also had lower idle and bigger loads, every season |
| goods per delivery | 4.3–8.0 against 8.6–10.9, on a 30-slot pack — most deliveries are one turn's gather |
| turns between a worker's deliveries | 3.4–4.8 on **both** sides; the walk is not the difference |
| idle share | v11: 36.3% against 4.7% |
| refusal rate | v13: 7.3% against 5.1%; v19 and v21: ~1% against 0% |
| tiles per worker-turn | v19: 2.84 against 1.51 on near-identical labour budgets |

The third row is the one that makes the second row usable. Load per trip alone accuses a
civilization whose fields sit beside its store; paired with the cycle length it says something real,
and v11 is the clean case — the same ~3.5-turn round trip returning 4.4 against 9.9.

`Efficiency.tsx` renders these as a table with the gap named per reading and **no composite, rank or
winner**. The rules define no victory condition and a season is one run, so the panel says so in
plain words. Two guards against reading a result into noise: a gap under a tenth prints 大致相同 and
names nobody, and a ratio against zero is replaced by the difference in the reading's own units.
`store.efficiency` is cumulative to the playhead turn, so scrubbing back never shows figures from
turns not yet on screen. None of it may reach a player.

### Fifth pass (2026-08-07) — the map draws how much is left

Shek's reading: *"can the farmland and stone ground have a kind of nice design visually showing full
/ mid / less / none — stone land in the middle seems to look like farm, hard to see."* Both halves
were fair, and the second was the more serious: every node was drawn as the same green dot whatever
it held, so the entirely-stone centre of the map read as farmland.

`src/v3/resource.ts` owns the whole scheme, and the map, the legend and the inspector all read it:

- **Shape is the kind** — a circle for food, a diamond for stone. Round for something that grows
  back, angular for something quarried out. Shape survives bleaching, six-pixel cells and colour
  blindness; hue does not, and a remembered tile is washed toward paper where the two resource
  greens converge.
- **Size is one of four named levels**, measured against that tile's own capacity: 充足 / 過半已採 /
  將盡 / 已採光. The old renderer scaled a radius continuously against a hard-coded 120, which is not
  a reading — two dots a few pixels apart are indistinguishable, and a 40-cap quarry was drawn
  permanently tiny even when completely full.
- **The ground drains with the level.** At fit zoom a cell is about six pixels and no glyph can be
  sized by eye, but a farm belt fading from green to bare paper is legible without looking at any
  single tile — and that is the reading that matters: how much is left near each home, and therefore
  how hard the map is pushing. On v21's `corridor-tight`, north's home quarry now reads at a glance
  as a field of husks.
- **Spent is drawn, not skipped.** Ground that never held anything and ground that has been worked
  out are different facts, and the old renderer drew both as bare terrain.
- **Field and stone ground are separated on hue**, not just value; they used to sit six points apart
  on every channel.
- The legend draws its marks with the map's own `drawNode`, on a canvas, background included. A
  legend that reproduces its subject in CSS drifts from it on the first change.

### Fourth pass (2026-08-07) — survival arithmetic and the season's silhouette

Shek's reading: *"it should show meaningful data, e.g. south and north home-nearby resource left —
why? because it means higher pressure to explore the middle"*, *"we also need to show how many food
is needed to survive, how much is in storage, and how much is expected next turn"*, and *"the Worker
Loom is one lane per worker; across a season it is really hard to know what is overall happening"*.

- **`Vitals.tsx` + `survival.ts` — can they eat, and is home running out.** Directly under the map,
  before any chart, because it is the state of the world at the playhead while everything below is
  history. It prints the upkeep sum rather than the stockpile: stored food, what standing still
  costs, the runway, what is stranded in backpacks, what the standing orders should deliver next
  turn. Then home food and the home quarry.
- **Home food is printed as a ratio against upkeep, and the wording flips below 1×.** The stockpile
  alone is meaningless — 7,841 food is a large number and 120 is a small one, but the figure that
  explains every season so far is the multiple: v13 regrew 16.5× the upkeep and neither side ever
  left home; `corridor-tight` regrows 0.2×. Below 1× the pile is being drawn down, and calling that
  "an income" states the opposite of what the number means.
- **Home stone is a countdown in blocks, not in stone.** Nobody can build with two stone, so the
  warning has to fire while there is still stone in the ground but no longer enough to place a
  block. `homeStone` is the engine's own `quarryLeft`, never a radius sum — on `corridor-tight` the
  quarry sits outside the build radius, so a radius sum reads 0 while forty stone is still there.
- **Gatherers count three ways and only one of them is work.** `gatherState` splits them into
  working (standing on a live source), walking, and **stalled** (standing on one that has been
  emptied). At v13 Turn 100 north held six of twelve people on a gather order for a mined-out tile:
  six nominally on food, nothing arriving. A headcount alone reads that as a civilization feeding
  itself. The stall leads the summary sentence only when it is actually costing the harvest —
  otherwise it is a clause, or every card with one idle order cries wolf.
- **`Effort.tsx` — the season at a glance, in two bands per side.** The Loom answers "what was *this
  person* doing"; ten lanes across 150 turns is 1,500 cells and nobody reads a season out of that.
  *Where the hands went* stacks every worker's standing job into one column per turn, so a civ that
  kept four people idle for forty turns has a pale stripe through its band. *What came off the map*
  is food and stone gathered, running total. **Cumulative on purpose**: a per-turn harvest is a
  sawtooth the eye cannot integrate, and a running total is monotonic, so the only thing left to
  read is the shape. Turns with no harvest row hold flat rather than interpolating — a sloped line
  through a gap draws slow steady work where there was none. Both bands share one scale and say so.
- **The home quarry chart is promoted out of the "more" drawer.** It is the one line on the page
  that can only fall, and the turn it reaches zero is the turn the map starts pushing outward.

### Filled in (2026-08-07) — the inspector and the pressure panel

Shek's reading of the built page: *"it seems missing lot of info — I click on the map, I should see
what's happening"* and *"can we have more meaningful chart or data, e.g. something related to
explore-or-die, so viewer understands 'oh this a good move, bad move'."* Both were fair. §7 of this
document specifies a four-layer inspector; what shipped was six chips, every one of which was
already drawn on the map. And every chart on the page reported a **level**, which cannot say whether
a decision was working.

- **`src/v3/Inspector.tsx`** — §7 as specified, extracted out of `page.tsx`. 狀態 / 現行指令 /
  本回合 / 模型怎麼說, with the claim layer in its own register. The standing job now carries what
  the rules make derivable from it: tiles left and turns at the fixed move rate, what is actually
  left in the tile being gathered, cells placed against cells needed with the stone still owed
  beside what the settlement holds, and **how many turns this job has been held** — an idle counter
  when the job is `idle`. That counter is the point of the whole panel: v15's four stranded workers
  and v13's 16-turn worksite stall are both one click away and were previously reachable only by
  reading raw JSON. The tile card gained terrain, cap and regrowth, structures, loose goods, who is
  standing there, who is walking there, and (truth lens only) which side has seen it and when.
- **`src/v3/Pressure.tsx`** — the explore-or-die instrument, and the answer to "good move or bad
  move" that does not require a score. Three runways, all division on the engine's own constants:
  food ÷ (people − harvest), stone ÷ structure upkeep due, and the walking cost to the nearest
  stone. When the third exceeds the first two the civilization is already lost and has not noticed.
  Two charts that no level chart can replace: **furthest person from home** against the build
  radius, and **people beyond the build radius** — v13's "never left" is a flat line, and it
  separates the two sides immediately (south spent 71 of 153 turns with somebody outside, north 25).
- **Two new read queries**, `store.pressure()` and `store.workerHistory()`, with regression tests in
  `test/research.test.ts` that play real turns rather than asserting on a hand-built frame.

Three honesty calls made here:

- **Upkeep is parsed from the engine's own event, never recomputed.** `turn_stats.blocks_placed`
  counts every standing block including unfinished worksites, while the engine bills completed
  structures only. Recomputing would score a season against a number it never played under.
- **"The rule does not apply" and "nobody is billable yet" are different states.** The engine logs
  nothing when nothing is due, so `pressure()` also returns `structureUpkeep`, taken from the
  season's stored `rules_hash`. A season opening under the rule states the rule and its free
  allowance instead of hiding the card.
- **The nearest *unseen* stone is 🔒 and says so.** It is the number that makes the trap legible —
  "there is no stone left anywhere they have seen; the nearest is 24 tiles away, and they do not
  know it exists" — and it is exactly the kind of number that must never reach a player.

### Built (2026-08-06) — the whole page

Status line with both seats · belief switch · since-you-last-looked band · playhead with landmark
ticks and `←`/`→` stepping · one lens-switched map with age-based fog, truth-outline toggle and intent
lines · the truth view as a single omniscient map · the gap/contact/turn gutter · a worker-and-tile
inspector that obeys the belief switch · resource bars split stored / in-backpacks against the
aggregate capacity of physical storage structures, with upkeep and join-threshold ticks · the turn spine in engine order with
refusals given their own block · the migration gate checklist evaluated live per civ · the Worker
Loom · seven charts (three shown, four behind 更多) with one playhead drawn through all of them ·
journal-beside-events. Everything reads live from the research API.

**Responsive layout:** the same single map scales down to the available width. The page must never
scroll horizontally; check `document.documentElement.scrollWidth` against `window.innerWidth`
after any layout change.

**Two honesty calls made while building:**

- Goods spilled on the ground are reported as one shared line, not folded into a civilization's
  bar. The engine drops them where a worker died and never assigns an owner, so attributing them
  would be a guess.
- Three of the four migration gates are exactly computable from the frame. The fourth — whether
  open ground exists beside the settlement — is only knowable inside the engine, so it appears
  only when the engine actually reported on it that turn.

### Where the data comes from

- **Charts** — `turn_stats`, one small query for a whole season. `seen_tiles` and `nearest_gap`
  were added for v3 and backfilled across every recorded season.
- **Harvest chart** — summed from `action_results` at read time. The engine writes the resource
  into the result text rather than a column, so the food/stone split keys off that text; it is
  engine-generated and fixed, never user input.
- **Loom** — the `worker_turns` table, written at resolve time and backfilled once by replaying
  stored worlds. It cannot come from `action_results` alone: a worker walking to a distant tile
  produces no result at all, and walking must not read as idle.
- **Turn spine, refusals** — `action_results` and `world_events` for that turn.
- **Maps** — `after_world_json` for the turn under the playhead only. Those blobs are large
  (377 MB for v13 alone) and must never be fetched in bulk.
