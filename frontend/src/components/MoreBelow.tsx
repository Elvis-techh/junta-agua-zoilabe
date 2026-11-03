import { useEffect, useRef, useState } from "react";

import { Icon } from "../icons.tsx";
import { hiddenBelow, isTyping, visibleBottomEdge } from "../viewport.ts";

/** What is left to see, in pixels, and how tall the visible part is. */
interface Measure {
  below: number;
  visible: number;
  scrolled: number;
}

const QUIET_MOTION = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/**
 * The last thing in a container that stays where it is. Not this hint, and not
 * a button pinned above the keyboard: that one is always in view, and fields
 * can still be hidden behind it.
 */
function lastContent(container: Element): Element | null {
  let last = container.lastElementChild;
  while (last && (last.classList.contains("more-below-slot") || getComputedStyle(last).position === "sticky")) {
    last = last.previousElementSibling;
  }
  return last;
}

function measurePage(): Measure | null {
  const main = document.querySelector("main.screen");
  const last = main && lastContent(main);
  // A dialog covers the screen, and it has its own hint.
  if (!last || document.querySelector(".overlay")) {
    return null;
  }
  const bar = document.querySelector(".bottombar");
  const barTop = bar && getComputedStyle(bar).display !== "none" ? bar.getBoundingClientRect().top : Infinity;
  const bottom = Math.min(visibleBottomEdge(), barTop);
  return { below: last.getBoundingClientRect().bottom - bottom, visible: bottom, scrolled: window.scrollY };
}

function measureDialog(dialog: Element): Measure | null {
  const last = lastContent(dialog);
  if (!last) {
    return null;
  }
  const box = dialog.getBoundingClientRect();
  const bottom = Math.min(visibleBottomEdge(), box.bottom);
  return { below: last.getBoundingClientRect().bottom - bottom, visible: bottom - box.top, scrolled: dialog.scrollTop };
}

/**
 * "Hay más abajo": shown whenever something on the screen or in a dialog is
 * below what can be seen, because someone who does not scroll would never find
 * it. Tapping it closes the keyboard and brings the rest up. It goes away when
 * everything has been seen, or once a person has scrolled a whole screen and so
 * clearly knows how, which keeps it off the rows of a long list.
 */
export function MoreBelow({ inDialog = false }: { inDialog?: boolean }) {
  const [showing, setShowing] = useState(false);
  const slot = useRef<HTMLDivElement>(null);

  const measure = () => {
    if (!inDialog) {
      return measurePage();
    }
    const dialog = slot.current?.closest(".dialog");
    return dialog ? measureDialog(dialog) : null;
  };

  useEffect(() => {
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const now = measure();
        setShowing(Boolean(now && hiddenBelow(now.below, 0) && now.scrolled <= now.visible));
      });
    };

    check();
    // In the capture phase, so a dialog's own scrolling is heard too.
    window.addEventListener("scroll", check, true);
    window.addEventListener("resize", check);
    window.visualViewport?.addEventListener("resize", check);
    // Another step, a dialog opening, an error message appearing, a font arriving.
    const changes = new MutationObserver(check);
    changes.observe(document.body, { childList: true, subtree: true });
    const sizes = new ResizeObserver(check);
    sizes.observe(document.body);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", check, true);
      window.removeEventListener("resize", check);
      window.visualViewport?.removeEventListener("resize", check);
      changes.disconnect();
      sizes.disconnect();
    };
  }, []);

  const reveal = () => {
    const active = document.activeElement;
    const typing = isTyping(active);
    if (typing) {
      (active as HTMLElement).blur();
    }
    // With the keyboard going away the screen is about to grow: measure after.
    window.setTimeout(
      () => {
        const now = measure();
        if (!now) {
          return;
        }
        const top = Math.min(now.below + 24, now.visible * 0.8);
        const behavior: ScrollBehavior = QUIET_MOTION() ? "auto" : "smooth";
        const dialog = inDialog ? slot.current?.closest(".dialog") : null;
        (dialog ?? window).scrollBy({ top, behavior });
      },
      typing ? 350 : 0,
    );
  };

  const hint = showing && (
    <button type="button" className={`more-below${inDialog ? " in-dialog" : ""}`} onClick={reveal}>
      <Icon name="down" size={24} /> Hay más abajo
    </button>
  );

  return inDialog ? (
    <div ref={slot} className="more-below-slot">
      {hint}
    </div>
  ) : (
    hint || null
  );
}
