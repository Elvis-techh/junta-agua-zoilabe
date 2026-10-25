import { useEffect, useState, useSyncExternalStore } from "react";

import type { Me } from "../api.ts";
import { api } from "../api.ts";
import type { Route } from "../home.ts";
import { navigation, routeOf, tabOf } from "../home.ts";
import { Icon } from "../icons.tsx";
import { censusQueue, remember, sendRegistration } from "../queue.ts";
import { CensusScreen } from "../screens/Census.tsx";
import { HistoryScreen } from "../screens/History.tsx";
import { HomeScreen } from "../screens/Home.tsx";
import { HouseholdScreen } from "../screens/Household.tsx";
import type { RegisterPreset } from "../screens/Register.tsx";
import { RegisterScreen } from "../screens/Register.tsx";
import { SettingsScreen } from "../screens/Settings.tsx";
import { UsersScreen } from "../screens/Users.tsx";
import { Dialog } from "./Dialog.tsx";

/** How often waiting census entries are tried again while the app is open. */
const RETRY_MS = 30_000;

export type Go = (route: Route, preset?: RegisterPreset) => void;

/**
 * The signed-in app: who is signed in on top, the screen, and the bottom bar.
 *
 * `offline` means the app was opened with no signal and is running on the
 * profile it remembered: census entries can still be typed and wait on the
 * phone, and everything else says there is no connection.
 */
export function Shell({ me, offline, onSignedOut, onRetry }: { me: Me; offline: boolean; onSignedOut: () => void; onRetry: () => void }) {
  const [route, setRoute] = useState<Route>(() => routeOf(window.location.pathname));
  const [preset, setPreset] = useState<RegisterPreset | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const pending = useSyncExternalStore(
    (listener) => censusQueue.subscribe(listener),
    () => censusQueue.pendingCount(me.id),
  );

  useEffect(() => {
    const onPop = () => setRoute(routeOf(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Send what is waiting now, whenever signal comes back, and every half minute.
  useEffect(() => {
    const send = () => void censusQueue.sendAll(me.id, sendRegistration);
    const back = () => (offline ? onRetry() : send());
    send();
    window.addEventListener("online", back);
    const timer = window.setInterval(send, RETRY_MS);
    return () => {
      window.removeEventListener("online", back);
      window.clearInterval(timer);
    };
  }, [me.id, offline, onRetry]);

  const go: Go = (next, nextPreset) => {
    setPreset(nextPreset ?? null);
    setMoreOpen(false);
    if (next !== route) {
      window.history.pushState(null, "", next);
    }
    setRoute(next);
    window.scrollTo(0, 0);
  };

  const signOut = async () => {
    await api("POST", "/auth/logout").catch(() => undefined);
    remember("me", null);
    onSignedOut();
  };

  const can = (permission: string) => me.permissions.includes(permission);
  const { bar, more } = navigation(me.permissions);
  const current = tabOf(route);

  const screen = () => {
    if ((route === "/censo" || route === "/censo/buscar") && can("census:view")) {
      return <CensusScreen me={me} onOpen={go} autoFocus={route === "/censo/buscar"} />;
    }
    if (route === "/censo/registrar" && can("census:edit")) {
      // A new key per start, so "Registrar otra" begins from a clean form.
      return <RegisterScreen key={preset?.startedAt ?? "start"} me={me} preset={preset} onOpen={go} />;
    }
    if (route.startsWith("/censo/vivienda/") && can("census:view")) {
      return <HouseholdScreen key={route} me={me} id={route.slice("/censo/vivienda/".length)} onOpen={go} />;
    }
    if (route === "/usuarios" && can("users:manage")) {
      return <UsersScreen me={me} />;
    }
    if (route === "/historial" && can("log:view")) {
      return <HistoryScreen />;
    }
    if (route === "/configuracion" && can("settings:edit")) {
      return <SettingsScreen />;
    }
    return <HomeScreen me={me} onOpen={go} />;
  };

  return (
    <>
      <header className="topbar">
        <Icon name="home" />
        <div className="who">
          <strong>{me.name}</strong>
          <span>{me.roleName}</span>
        </div>
        {pending > 0 && (
          <button className="pending-chip" onClick={() => go("/censo")}>
            <Icon name="upload" size={20} /> {pending} por enviar
          </button>
        )}
      </header>

      {offline && (
        <div className="offline-banner" role="status">
          <Icon name="signal" size={22} />
          <span>Sin señal. Lo que registre se guarda en el teléfono y se envía cuando haya señal.</span>
          <button className="btn" onClick={onRetry}>Intentar</button>
        </div>
      )}

      {screen()}

      <nav className="bottombar" aria-label="Secciones">
        {bar.map((tab) => (
          <button key={tab.route} aria-current={current === tab.route ? "page" : undefined} onClick={() => go(tab.route)}>
            <Icon name={tab.icon} />
            {tab.label}
          </button>
        ))}
        {more.length > 0 ? (
          <button
            aria-current={more.some((tab) => tab.route === current) ? "page" : undefined}
            onClick={() => setMoreOpen(true)}
          >
            <Icon name="more" />
            Más
          </button>
        ) : (
          <button onClick={() => void signOut()}>
            <Icon name="exit" />
            Salir
          </button>
        )}
      </nav>

      {moreOpen && (
        <Dialog title="Más" onClose={() => setMoreOpen(false)}>
          {more.map((tab) => (
            <button key={tab.route} className="btn block" onClick={() => go(tab.route)}>
              <Icon name={tab.icon} /> {tab.label}
            </button>
          ))}
          <button className="btn danger block" onClick={() => void signOut()}>
            <Icon name="exit" /> Salir
          </button>
        </Dialog>
      )}
    </>
  );
}
