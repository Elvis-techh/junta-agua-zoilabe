import type { ReactNode } from "react";
import { useEffect, useLayoutEffect } from "react";

import { Icon } from "../icons.tsx";
import { lockScroll } from "../scrollLock.ts";

/**
 * A panel over the screen, from the bottom on a phone. Escape or "Cerrar"
 * closes it. The screen behind it stays still while it is open.
 */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useLayoutEffect(() => lockScroll(window), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog stack" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
          <h1 style={{ margin: 0 }}>{title}</h1>
          <button className="btn" onClick={onClose} aria-label="Cerrar">
            <Icon name="x" /> Cerrar
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
