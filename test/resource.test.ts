import { describe, expect, test } from "bun:test";
import { DRAIN, levelOf } from "../src/v3/resource";

/**
 * The map's resource scale is the one place where a rendering decision changes what a reader
 * believes about the world, so its boundaries are pinned rather than left to the drawing code.
 */

describe("resource levels", () => {
  test("levels are fractions of the tile's own capacity, not of a shared constant", () => {
    // A field caps at 120 and a home quarry at about 40. On an absolute scale every quarry on the
    // map would read as nearly empty from turn one, which is the bug this replaced.
    expect(levelOf(120, 120)).toBe("full");
    expect(levelOf(40, 40)).toBe("full");
    expect(levelOf(40, 120)).toBe("mid");
    expect(levelOf(20, 40)).toBe("mid");
  });

  test("the boundaries are two thirds and one third, inclusive from above", () => {
    expect(levelOf(80, 120)).toBe("full");
    expect(levelOf(79, 120)).toBe("mid");
    expect(levelOf(40, 120)).toBe("mid");
    expect(levelOf(39, 120)).toBe("low");
  });

  test("an emptied source is `spent`, never `low`", () => {
    // The distinction is the whole point of drawing a husk: ground that never held anything and
    // ground that has been worked out must not look the same. `low` still has something in it.
    expect(levelOf(1, 120)).toBe("low");
    expect(levelOf(0, 120)).toBe("spent");
    expect(levelOf(-3, 120)).toBe("spent");
  });

  test("a capless tile cannot read as full", () => {
    expect(levelOf(5, 0)).toBe("low");
  });

  test("the ground drains monotonically as the level falls", () => {
    // The tint carries the reading at fit zoom, where no glyph can be sized by eye. If two levels
    // ever share a drain, a whole belt of half-worked farmland becomes indistinguishable from a
    // full one at the only zoom where the belt is visible as a belt.
    expect(DRAIN.full).toBeLessThan(DRAIN.mid);
    expect(DRAIN.mid).toBeLessThan(DRAIN.low);
    expect(DRAIN.low).toBeLessThan(DRAIN.spent);
    expect(DRAIN.spent).toBeLessThan(1);
  });
});
