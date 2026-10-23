import type { Me } from "../api.ts";
import type { Route } from "../home.ts";
import { homeButtons } from "../home.ts";
import { Icon } from "../icons.tsx";

/** Inicio: a few large buttons chosen by the user's role. */
export function HomeScreen({ me, onOpen }: { me: Me; onOpen: (route: Route) => void }) {
  const buttons = homeButtons(me.roleCode, me.permissions);

  return (
    <main className="screen stack">
      <h1>Inicio</h1>
      <div className="home-grid">
        {buttons.map((button) => (
          <button
            key={button.label}
            className="home-btn"
            disabled={!button.route}
            onClick={() => button.route && onOpen(button.route)}
          >
            <Icon name={button.icon} size={36} />
            {button.label}
            {!button.route && <small>Próximamente</small>}
          </button>
        ))}
      </div>
    </main>
  );
}
