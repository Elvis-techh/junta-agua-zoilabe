import { useEffect, useState, useSyncExternalStore } from "react";

import type { Me } from "../api.ts";
import { api } from "../api.ts";
import type { IncomePreset } from "../collect.ts";
import type { SummaryPart } from "../monthSummary.ts";
import type { Route } from "../home.ts";
import { labelOf, markFrom, navigation, previousOf, routeOf, tabOf } from "../home.ts";
import { Icon } from "../icons.tsx";
import { censusQueue, remember, sendRegistration } from "../queue.ts";
import { ArrearsScreen } from "../screens/Arrears.tsx";
import { CensusScreen } from "../screens/Census.tsx";
import type { PaymentPreset } from "../screens/Collect.tsx";
import { CollectScreen, PaymentScreen } from "../screens/Collect.tsx";
import { ExpenseScreen } from "../screens/Expense.tsx";
import { HistoryScreen } from "../screens/History.tsx";
import { HomeScreen } from "../screens/Home.tsx";
import { HouseholdScreen } from "../screens/Household.tsx";
import { IncomeScreen } from "../screens/Income.tsx";
import { ClosedMonthScreen, MonthCloseScreen } from "../screens/MonthClose.tsx";
import { MonthSummaryScreen } from "../screens/MonthSummary.tsx";
import { OpeningBalanceScreen } from "../screens/OpeningBalance.tsx";
import type { RegisterPreset } from "../screens/Register.tsx";
import { RegisterScreen } from "../screens/Register.tsx";
import { SettingsScreen } from "../screens/Settings.tsx";
import { StatementScreen } from "../screens/Statement.tsx";
import { UsersScreen } from "../screens/Users.tsx";
import { PreviousScreen } from "./BackButton.tsx";
import { Dialog } from "./Dialog.tsx";
import { MoreBelow } from "./MoreBelow.tsx";

/** How often waiting census entries are tried again while the app is open. */
const RETRY_MS = 30_000;

/** What a screen is opened with: a census start, a payment to record again, or what Cobrar was told is being paid. */
export type Preset = RegisterPreset | PaymentPreset | IncomePreset;

export type Go = (route: Route, preset?: Preset) => void;

/**
 * The signed-in app: who is signed in on top, the screen, and the bottom bar.
 *
 * `offline` means the app was opened with no signal and is running on the
 * profile it remembered: census entries can still be typed and wait on the
 * phone, and everything else says there is no connection.
 */
export function Shell({ me, offline, onSignedOut, onRetry }: { me: Me; offline: boolean; onSignedOut: () => void; onRetry: () => void }) {
  const [route, setRoute] = useState<Route>(() => routeOf(window.location.pathname));
  const [preset, setPreset] = useState<Preset | null>(null);
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
      // The entry remembers the screen it was opened from, for "‹" on the next one.
      window.history.pushState(markFrom(route), "", next);
    }
    setRoute(next);
    // After the screen changes: a dialog closing puts the old position back first.
    requestAnimationFrame(() => window.scrollTo(0, 0));
  };

  const signOut = async () => {
    await api("POST", "/auth/logout").catch(() => undefined);
    remember("me", null);
    onSignedOut();
  };

  const can = (permission: string) => me.permissions.includes(permission);
  const { bar, more } = navigation(me.permissions);
  const current = tabOf(route);
  // Read while drawing: go() writes the history entry before the route changes, and a popstate has already moved to its entry.
  const from = previousOf(window.history.state);
  const previous = from ? { label: labelOf(from), back: () => window.history.back() } : null;

  const screen = () => {
    if ((route === "/censo" || route === "/censo/buscar") && can("census:view")) {
      return <CensusScreen me={me} onOpen={go} autoFocus={route === "/censo/buscar"} />;
    }
    if (route === "/censo/registrar" && can("census:edit")) {
      // A new key per start, so "Registrar otra" begins from a clean form.
      const start = preset && "startedAt" in preset ? preset : null;
      return <RegisterScreen key={start?.startedAt ?? "start"} me={me} preset={start} onOpen={go} />;
    }
    if (route.startsWith("/censo/vivienda/") && can("census:view")) {
      return <HouseholdScreen key={route} me={me} id={route.slice("/censo/vivienda/".length)} onOpen={go} />;
    }
    if (route === "/finanzas/cobrar" && can("finance:record") && can("census:view")) {
      return <CollectScreen onOpen={go} canSeeOwed={can("finance:view")} />;
    }
    if (route.startsWith("/finanzas/cobrar/") && can("finance:record") && can("finance:view")) {
      const again = preset && "again" in preset ? preset.again : undefined;
      return (
        <PaymentScreen key={`${route}${again?.id ?? ""}`} id={route.slice("/finanzas/cobrar/".length)} again={again} onOpen={go} />
      );
    }
    if (route === "/finanzas/quien-debe" && can("finance:view")) {
      return <ArrearsScreen onOpen={go} />;
    }
    if (route === "/finanzas/saldo" && can("finance:view")) {
      return <OpeningBalanceScreen canRecord={can("finance:record")} canCorrect={can("finance:reverse")} onOpen={go} />;
    }
    if (route === "/finanzas/cierre" && can("finance:view")) {
      return <MonthCloseScreen abilities={{ meId: me.id, canPrepare: can("month:prepare"), canApprove: can("month:approve") }} onOpen={go} />;
    }
    if (route.startsWith("/finanzas/cierre/") && can("finance:view")) {
      return <ClosedMonthScreen key={route} month={route.slice("/finanzas/cierre/".length)} onOpen={go} />;
    }
    // Resumen del mes: the month in progress, a month ("/finanzas/resumen/2026-10-01"), or one of its parts.
    if ((route === "/finanzas/resumen" || route.startsWith("/finanzas/resumen/")) && can("finance:view")) {
      const [month = null, part = null] = route.split("/").slice(3);
      return <MonthSummaryScreen key={route} month={month} part={part as SummaryPart | null} canHandOut={can("export:finance")} onOpen={go} />;
    }
    // Otro ingreso: from Inicio it finds the house in the census (or none); from Cobrar or a house's file, by id.
    if (route === "/finanzas/ingreso" && can("finance:record") && can("finance:view") && can("census:view")) {
      return <IncomeScreen key={route} canReverse={can("finance:reverse")} canHandOut={can("export:finance")} onOpen={go} />;
    }
    if (route.startsWith("/finanzas/ingreso/") && can("finance:record") && can("finance:view") && can("census:view")) {
      const chosen = preset && "incomeType" in preset ? preset : undefined;
      return (
        <IncomeScreen
          key={`${route}${chosen?.incomeType ?? ""}`}
          householdId={route.slice("/finanzas/ingreso/".length)}
          preset={chosen}
          canReverse={can("finance:reverse")}
          canHandOut={can("export:finance")}
          onOpen={go}
        />
      );
    }
    if (route.startsWith("/finanzas/estado/") && can("finance:view") && can("census:view")) {
      return <StatementScreen key={route} householdId={route.slice("/finanzas/estado/".length)} canHandOut={can("export:finance")} onOpen={go} />;
    }
    if (route === "/finanzas/gasto" && can("finance:record") && can("finance:view")) {
      return <ExpenseScreen key={route} canReverse={can("finance:reverse")} onOpen={go} />;
    }
    if (route === "/usuarios" && can("users:manage")) {
      return <UsersScreen me={me} onOpen={go} />;
    }
    if (route === "/historial" && can("log:view")) {
      return <HistoryScreen onOpen={go} />;
    }
    if (route === "/configuracion" && can("settings:edit")) {
      return <SettingsScreen onOpen={go} />;
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

      <PreviousScreen.Provider value={previous}>{screen()}</PreviousScreen.Provider>

      <MoreBelow />

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
