import { Icon } from "../icons.tsx";

/**
 * The way back, at the top left of a screen, named after where it goes:
 * "‹ Inicio". The phone's own back works too, but not everyone knows it is
 * there (owner, 19 November 2026).
 */
export function BackButton({ label = "Inicio", onClick }: { label?: string; onClick: () => void }) {
  return (
    <button className="btn" style={{ justifySelf: "start" }} onClick={onClick}>
      <Icon name="back" /> {label}
    </button>
  );
}
