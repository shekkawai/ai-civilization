import { useEffect, useState } from "react";

/**
 * One definition of "narrow" for the whole page.
 *
 * Every section on this page was laid out for a desk and then met a phone: a 560px table, a 132px
 * label column, an SVG with a 300px intrinsic width inside a 273px track. Each of them overflowed
 * in its own way and the page's `overflow-x: clip` hid the evidence, so a phone reader saw a column
 * of figures with the second civilization cut off the right-hand side — on a page whose entire
 * purpose is comparing two civilizations.
 *
 * A media query in JS rather than CSS because these components style themselves inline, and a
 * component that has to *restructure* (table → cards) cannot do it from a stylesheet anyway.
 */
export const NARROW = 640;

export function useNarrow(breakpoint: number = NARROW) {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth < breakpoint,
  );
  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [breakpoint]);
  return narrow;
}
