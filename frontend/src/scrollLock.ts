/**
 * Keeps the screen behind a dialog still, on a computer and on a phone.
 *
 * `overflow: hidden` on the page is not enough: a phone still scrolls it by
 * touch. Taking the page out of the flow with `position: fixed` stops that, so
 * its position is remembered and put back when the last dialog closes.
 *
 * Counted, because one dialog can open another (a confirmation over a form).
 */
export interface ScrollablePage {
  scrollY: number;
  scrollTo(x: number, y: number): void;
  document: { body: { style: { position: string; top: string; left: string; right: string; overflow: string } } };
}

const held = new WeakMap<ScrollablePage, { count: number; y: number }>();

/** Stop the page from scrolling; the function it returns lets it go again. */
export function lockScroll(page: ScrollablePage): () => void {
  const state = held.get(page) ?? { count: 0, y: 0 };
  held.set(page, state);

  const { style } = page.document.body;
  if (state.count === 0) {
    state.y = page.scrollY;
    style.position = "fixed";
    style.top = `-${state.y}px`;
    style.left = "0";
    style.right = "0";
    style.overflow = "hidden";
  }
  state.count += 1;

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    state.count -= 1;
    if (state.count === 0) {
      style.position = "";
      style.top = "";
      style.left = "";
      style.right = "";
      style.overflow = "";
      page.scrollTo(0, state.y);
    }
  };
}
