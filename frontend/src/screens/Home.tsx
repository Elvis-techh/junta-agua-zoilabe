import type { Me } from "../api.ts";
import type { HomeButton, Route } from "../home.ts";
import { homeSections } from "../home.ts";
import { Icon } from "../icons.tsx";

/**
 * Inicio: first the large buttons for what the user's role usually does,
 * then every other screen the board may open, under "Otras tareas", so no
 * role misses a screen because it is not its usual job. Usuarios, Permisos
 * and Configuración come last, under "Administración": they are seldom
 * needed, and the day's work goes first (owner, 19 November 2026).
 */
export function HomeScreen({ me, onOpen }: { me: Me; onOpen: (route: Route) => void }) {
  const { own, others, setup } = homeSections(me.roleCode, me.permissions);

  return (
    <main className="screen stack">
      <h1>Inicio</h1>
      {own.length > 0 && <HomeGrid buttons={own} onOpen={onOpen} />}
      {others.length > 0 && (
        <>
          {/* Straight under Inicio when the role's own buttons are all setup ones (the administrator). */}
          {own.length > 0 && <h2>Otras tareas</h2>}
          <HomeGrid buttons={others} onOpen={onOpen} />
        </>
      )}
      {setup.length > 0 && (
        <>
          <h2>Administración</h2>
          <HomeGrid buttons={setup} onOpen={onOpen} />
        </>
      )}
    </main>
  );
}

function HomeGrid({ buttons, onOpen }: { buttons: HomeButton[]; onOpen: (route: Route) => void }) {
  return (
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
  );
}
