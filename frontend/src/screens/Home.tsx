import type { Me } from "../api.ts";
import type { Route } from "../home.ts";
import { homeButtons, otherTasks } from "../home.ts";
import { Icon } from "../icons.tsx";

/**
 * Inicio: large buttons for what the user's role usually does, then, smaller,
 * the other tasks they may do (every role may do everything since 6 November
 * 2026).
 */
export function HomeScreen({ me, onOpen }: { me: Me; onOpen: (route: Route) => void }) {
  const buttons = homeButtons(me.roleCode, me.permissions);
  const others = otherTasks(me.roleCode, me.permissions);

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

      {others.length > 0 && (
        <section className="home-more">
          <h2>Otras tareas</h2>
          <div className="home-grid home-grid-small">
            {others.map((button) => (
              <button key={button.label} className="home-btn" onClick={() => button.route && onOpen(button.route)}>
                <Icon name={button.icon} size={28} />
                {button.label}
              </button>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
