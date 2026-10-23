import { useEffect, useState } from "react";

import type { Me } from "../api.ts";
import { api } from "../api.ts";
import type { Route } from "../home.ts";
import { tabs } from "../home.ts";
import { Icon } from "../icons.tsx";
import { HistoryScreen } from "../screens/History.tsx";
import { HomeScreen } from "../screens/Home.tsx";
import { UsersScreen } from "../screens/Users.tsx";

function currentRoute(): Route {
  const path = window.location.pathname;
  return path === "/usuarios" || path === "/historial" ? path : "/";
}

/** The signed-in app: who is signed in on top, the screen, and the bottom bar. */
export function Shell({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  const [route, setRoute] = useState<Route>(currentRoute);

  useEffect(() => {
    const onPop = () => setRoute(currentRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = (next: Route) => {
    if (next !== route) {
      window.history.pushState(null, "", next);
      setRoute(next);
      window.scrollTo(0, 0);
    }
  };

  const signOut = async () => {
    await api("POST", "/auth/logout").catch(() => undefined);
    onSignedOut();
  };

  const can = (permission: string) => me.permissions.includes(permission);

  return (
    <>
      <header className="topbar">
        <Icon name="home" />
        <div className="who">
          <strong>{me.name}</strong>
          <span>{me.roleName}</span>
        </div>
      </header>

      {route === "/usuarios" && can("users:manage") ? (
        <UsersScreen me={me} />
      ) : route === "/historial" && can("log:view") ? (
        <HistoryScreen />
      ) : (
        <HomeScreen me={me} onOpen={go} />
      )}

      <nav className="bottombar" aria-label="Secciones">
        {tabs(me.permissions).map((tab) => (
          <button
            key={tab.route}
            aria-current={route === tab.route ? "page" : undefined}
            onClick={() => go(tab.route)}
          >
            <Icon name={tab.icon} />
            {tab.label}
          </button>
        ))}
        <button onClick={() => void signOut()}>
          <Icon name="exit" />
          Salir
        </button>
      </nav>
    </>
  );
}
