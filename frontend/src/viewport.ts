/**
 * What part of the screen a person can actually see.
 *
 * Someone who has only used WhatsApp will not look for a button behind the
 * keyboard, and will not scroll down to find one. So the app keeps track of
 * the visible part of the screen: `watchScreen` marks the page while the
 * keyboard is open (the rules are in styles.css), and MoreBelow.tsx says so
 * when something is hidden further down.
 *
 * Chrome on Android shrinks the page for the keyboard (the viewport tag in
 * index.html asks it to). An iPhone does not, so there `--keyboard` holds the
 * height to stay clear of.
 */

/** Less than this could be the browser's address bar hiding, not a keyboard. */
const KEYBOARD_MIN_PX = 120;

/** A little overhang, like a button's shadow, does not count as hidden. */
const HIDDEN_MIN_PX = 4;

const FOCUS_LEFT_WAIT_MS = 250;

const NO_KEYBOARD_INPUTS = new Set(["button", "checkbox", "color", "date", "file", "month", "radio", "range", "reset", "submit"]);

/** The keyboard is open when someone is typing and the screen is clearly shorter than it has been. */
export function isKeyboardOpen(tallestHeight: number, height: number, typing: boolean): boolean {
  return typing && tallestHeight - height > KEYBOARD_MIN_PX;
}

/** Whether this element brings up the keyboard. */
export function isTyping(element: { tagName: string; getAttribute(name: string): string | null } | null): boolean {
  if (!element) {
    return false;
  }
  if (element.tagName === "TEXTAREA") {
    return true;
  }
  return element.tagName === "INPUT" && !NO_KEYBOARD_INPUTS.has(element.getAttribute("type") ?? "text");
}

/**
 * Whether more typing is coming after this field. While it is, the next field
 * is what the person needs to see, so the button stays where it is; on the last
 * one, the button is what comes next, and it is pinned above the keyboard.
 */
export function moreTypingAfter<T extends { tagName: string; getAttribute(name: string): string | null }>(
  fields: T[],
  active: T | null,
): boolean {
  const at = active ? fields.indexOf(active) : -1;
  return at !== -1 && fields.slice(at + 1).some(isTyping);
}

/** Whether content ending at `contentBottom` runs past the bottom of what can be seen. */
export function hiddenBelow(contentBottom: number, visibleBottom: number): boolean {
  return contentBottom - visibleBottom > HIDDEN_MIN_PX;
}

/** A phone or tablet, where focusing a field brings up the keyboard over the screen. */
export function isTouchScreen(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
}

/** The bottom edge of what can be seen, in the same coordinates as `getBoundingClientRect`. */
export function visibleBottomEdge(): number {
  const viewport = window.visualViewport;
  return viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
}

/** Keep the page's keyboard mark and `--screen-*` values up to date. Called once, when the app starts. */
export function watchScreen(): void {
  const viewport = window.visualViewport;
  const root = document.documentElement;
  let tallest = 0;
  let width = 0;
  let wasOpen = false;

  const update = () => {
    const scale = viewport?.scale ?? 1;
    const height = (viewport?.height ?? window.innerHeight) * scale;
    const currentWidth = (viewport?.width ?? window.innerWidth) * scale;
    // Turning the phone changes what "tall" means.
    if (currentWidth !== width) {
      width = currentWidth;
      tallest = 0;
    }
    tallest = Math.max(tallest, height);

    const open = isKeyboardOpen(tallest, height, isTyping(document.activeElement));
    root.classList.toggle("keyboard-open", open);

    const active = document.activeElement;
    const fields = [...(active?.closest(".dialog, main")?.querySelectorAll("input, textarea") ?? [])];
    root.classList.toggle("keyboard-last-field", open && !moreTypingAfter(fields, active));

    // Not while zoomed in: the dialog follows the page, not the zoomed part.
    if (viewport && scale === 1) {
      root.style.setProperty("--screen-height", `${viewport.height}px`);
      root.style.setProperty("--screen-top", `${viewport.offsetTop}px`);
      root.style.setProperty("--keyboard", `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`);
    }

    // The bars just went away and the page moved: bring the field back into view.
    if (open && !wasOpen) {
      requestAnimationFrame(() => active?.scrollIntoView({ block: "nearest" }));
    }
    wasOpen = open;
  };

  viewport?.addEventListener("resize", update);
  viewport?.addEventListener("scroll", update);
  window.addEventListener("resize", update);
  document.addEventListener("focusin", update);
  // A little later: pressing a pinned button takes the focus off the field, and
  // moving the button at that moment would lose the press.
  document.addEventListener("focusout", () => window.setTimeout(update, FOCUS_LEFT_WAIT_MS));
  update();
}
