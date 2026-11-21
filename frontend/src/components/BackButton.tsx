import { createContext, useContext } from "react";

import { Icon } from "../icons.tsx";

/**
 * The screen the person was on before this one, set by the Shell: its name
 * for the button, and the way to go back to it. Null when this screen was
 * opened from outside the app, or is the first one.
 */
export interface Previous {
  label: string;
  back: () => void;
}

export const PreviousScreen = createContext<Previous | null>(null);

/**
 * The way back, at the top left of a screen, named after where it goes:
 * "‹ Quién debe". It goes to the screen the person came from, whichever it
 * was; when there is none (the app was opened on this screen), it goes to
 * `label`'s screen through `onClick`, which is Inicio unless a screen says
 * otherwise. The phone's own back works too, but not everyone knows it is
 * there (owner, 19 November 2026); and a house opened from Quién debe must
 * not go back to Censo, a page its visitor never saw (owner, 20 November 2026).
 */
export function BackButton({ label = "Inicio", onClick }: { label?: string; onClick: () => void }) {
  const previous = useContext(PreviousScreen);
  return (
    <button className="btn" style={{ justifySelf: "start" }} onClick={previous ? previous.back : onClick}>
      <Icon name="back" /> {previous ? previous.label : label}
    </button>
  );
}
