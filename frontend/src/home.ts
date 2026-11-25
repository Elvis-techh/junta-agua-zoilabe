import type { IconName } from "./icons.tsx";

export type Route =
  | "/"
  | "/usuarios"
  | "/historial"
  | "/censo"
  | "/censo/buscar"
  | "/censo/registrar"
  | "/censo/lista"
  | "/censo/verificar"
  | "/configuracion"
  | "/finanzas/cobrar"
  | "/finanzas/ingreso"
  | "/finanzas/gasto"
  | "/finanzas/quien-debe"
  | "/finanzas/saldo"
  | "/finanzas/cierre"
  | "/finanzas/resumen"
  | `/censo/vivienda/${string}`
  | `/finanzas/cierre/${string}`
  | `/finanzas/resumen/${string}`
  | `/finanzas/cobrar/${string}`
  | `/finanzas/ingreso/${string}`
  | `/finanzas/estado/${string}`;

/** The screen for an address, or Inicio for one this app does not have. */
export function routeOf(path: string): Route {
  const fixed: Route[] = [
    "/usuarios",
    "/historial",
    "/censo",
    "/censo/buscar",
    "/censo/registrar",
    "/censo/lista",
    "/censo/verificar",
    "/configuracion",
    "/finanzas/cobrar",
    "/finanzas/ingreso",
    "/finanzas/gasto",
    "/finanzas/quien-debe",
    "/finanzas/saldo",
    "/finanzas/cierre",
    "/finanzas/resumen",
  ];
  if ((fixed as string[]).includes(path)) {
    return path as Route;
  }
  if (/^\/(censo\/vivienda|finanzas\/cobrar|finanzas\/ingreso|finanzas\/estado)\/[0-9a-f-]{36}$/.test(path)) {
    return path as Route;
  }
  if (/^\/finanzas\/cierre\/\d{4}-(0[1-9]|1[0-2])-01$/.test(path)) {
    return path as Route;
  }
  // Resumen del mes: a month, and its parts (what came in, what was spent, the month's fee, its document).
  if (/^\/finanzas\/resumen\/\d{4}-(0[1-9]|1[0-2])-01(\/(entradas|gastos|cuota|documento))?$/.test(path)) {
    return path as Route;
  }
  return "/";
}

/**
 * What a screen is called on a back button ("‹ Quién debe"), in the village's
 * words. A house's file is a "Vivienda"; a month's parts are all "Resumen".
 */
export function labelOf(route: Route): string {
  const names: Record<string, string> = {
    "/": "Inicio",
    "/usuarios": "Usuarios",
    "/historial": "Historial",
    "/censo": "Censo",
    "/censo/buscar": "Buscar",
    "/censo/registrar": "Registrar familia",
    "/censo/lista": "Lista del censo",
    "/censo/verificar": "Verificación",
    "/configuracion": "Configuración",
    "/finanzas/cobrar": "Cobrar",
    "/finanzas/ingreso": "Otro ingreso",
    "/finanzas/gasto": "Gasto",
    "/finanzas/quien-debe": "Quién debe",
    "/finanzas/saldo": "Saldo de la junta",
    "/finanzas/cierre": "Cierre del mes",
    "/finanzas/resumen": "Resumen del mes",
  };
  const fixed = names[route];
  if (fixed) {
    return fixed;
  }
  if (route.startsWith("/censo/vivienda/")) {
    return "Vivienda";
  }
  if (route.startsWith("/finanzas/cobrar/")) {
    return "Cobrar";
  }
  if (route.startsWith("/finanzas/ingreso/")) {
    return "Otro ingreso";
  }
  if (route.startsWith("/finanzas/estado/")) {
    return "Estado de cuenta";
  }
  if (route.startsWith("/finanzas/cierre/")) {
    return "Cierre del mes";
  }
  return "Resumen";
}

/**
 * What the app writes into the browser's history entry when it opens a screen:
 * the screen the person was on. "‹ Atrás" can then go back to it and name it
 * (owner, 20 November 2026). An entry opened from outside the app, or a very
 * old one, has none.
 */
export interface HistoryMark {
  from: Route;
}

export function markFrom(route: Route): HistoryMark {
  return { from: route };
}

/** The screen before this one, read from a history entry's state; null when there is none the app can trust. */
export function previousOf(state: unknown): Route | null {
  if (typeof state !== "object" || state === null || !("from" in state) || typeof state.from !== "string") {
    return null;
  }
  // routeOf answers "/" for what it does not know, so an unknown address (or "/" itself, which is a real answer) is checked back.
  const route = routeOf(state.from);
  return route === state.from ? route : null;
}

export interface HomeButton {
  label: string;
  icon: IconName;
  /** Where it goes; absent for the screens later phases build. */
  route?: Route;
  /** The button shows only when the user holds this permission. */
  permission?: string;
}

const B = {
  registrar: { label: "Registrar familia", icon: "house", route: "/censo/registrar", permission: "census:edit" },
  buscar: { label: "Buscar", icon: "search", route: "/censo/buscar", permission: "census:view" },
  lista: { label: "Lista", icon: "list", route: "/censo", permission: "census:view" },
  censo: { label: "Censo", icon: "list", route: "/censo", permission: "census:view" },
  cobrar: { label: "Cobrar", icon: "cash", route: "/finanzas/cobrar", permission: "finance:record" },
  gasto: { label: "Gasto", icon: "receipt", route: "/finanzas/gasto", permission: "finance:record" },
  // Money from someone outside the census, and the latest entries to undo (Anular); for a house, Cobrar asks (19 November 2026).
  ingreso: { label: "Otro ingreso", icon: "plus", route: "/finanzas/ingreso", permission: "finance:record" },
  resumen: { label: "Resumen del mes", icon: "chart", route: "/finanzas/resumen", permission: "finance:view" },
  quienDebe: { label: "Quién debe", icon: "alert", route: "/finanzas/quien-debe", permission: "finance:view" },
  saldo: { label: "Saldo de la junta", icon: "chart", route: "/finanzas/saldo", permission: "finance:view" },
  // One screen, three names: what each role goes there to do (owner, 19 November 2026).
  cierre: { label: "Cierre del mes", icon: "check", route: "/finanzas/cierre", permission: "finance:view" },
  preparar: { label: "Preparar cierre", icon: "check", route: "/finanzas/cierre", permission: "month:prepare" },
  aprobar: { label: "Aprobar cierre", icon: "check", route: "/finanzas/cierre", permission: "month:approve" },
  reportes: { label: "Reportes", icon: "print" },
  historial: { label: "Historial", icon: "clock", route: "/historial", permission: "log:view" },
  usuarios: { label: "Usuarios", icon: "people", route: "/usuarios", permission: "users:manage" },
  permisos: { label: "Permisos", icon: "key" },
  configuracion: { label: "Configuración", icon: "gear", route: "/configuracion", permission: "settings:edit" },
} satisfies Record<string, HomeButton>;

/** The home screen's large buttons for each role (App Plan, "Screens and navigation"). */
export const HOME_BUTTONS: Record<string, HomeButton[]> = {
  secretario: [B.registrar, B.buscar, B.lista],
  tesorero: [B.cobrar, B.gasto, B.resumen, B.quienDebe, B.preparar],
  presidente: [B.aprobar, B.resumen, B.historial, B.usuarios],
  vicepresidente: [B.aprobar, B.resumen, B.historial, B.usuarios],
  fiscal: [B.resumen, B.historial, B.reportes],
  primer_vocal: [B.censo, B.resumen, B.reportes],
  segundo_vocal: [B.censo, B.resumen, B.reportes],
  administrador: [B.usuarios, B.permisos, B.configuracion],
};

/** This user's buttons: their role's, less any whose permission the Permisos tab took away. */
export function homeButtons(roleCode: string, permissions: readonly string[]): HomeButton[] {
  return (HOME_BUTTONS[roleCode] ?? []).filter(
    (button) => !button.permission || permissions.includes(button.permission),
  );
}

/**
 * Every other screen this user may open, under their role's buttons ("then
 * the other tasks below them", App Plan, "Screens and navigation"). The whole
 * board may do everything (6 November 2026), so every role, the administrator
 * too, finds every built screen on Inicio, not only those of its usual job
 * (owner, 14 November 2026). Built screens only, each once.
 */
export function otherButtons(roleCode: string, permissions: readonly string[]): HomeButton[] {
  const shown = new Set(homeButtons(roleCode, permissions).map((button) => button.route));
  return (Object.values(B) as HomeButton[]).filter((button) => {
    if (!button.route || shown.has(button.route) || (button.permission && !permissions.includes(button.permission))) {
      return false;
    }
    shown.add(button.route);
    return true;
  });
}

/**
 * The board's setup screens. On Inicio they come last, under
 * "Administración", for every role: they are opened now and then, and the
 * day's work goes first (owner, 19 November 2026).
 */
const SETUP: readonly HomeButton[] = [B.usuarios, B.permisos, B.configuracion];

export interface HomeSections {
  /** The role's own buttons, less the setup ones. */
  own: HomeButton[];
  /** "Otras tareas": every other built screen this user may open. */
  others: HomeButton[];
  /** "Administración", last: Usuarios, Permisos, Configuración. */
  setup: HomeButton[];
}

/**
 * Inicio in its order: the role's usual work, every other task, then the
 * setup screens at the bottom. An administrator, whose usual buttons are
 * all setup ones, therefore sees the other tasks first.
 */
export function homeSections(roleCode: string, permissions: readonly string[]): HomeSections {
  const isSetup = (button: HomeButton) => SETUP.includes(button);
  const own = homeButtons(roleCode, permissions);
  const others = otherButtons(roleCode, permissions);
  // A setup button the role holds shows even before its screen is built ("Próximamente").
  const setup = SETUP.filter((button) => own.includes(button) || others.includes(button));
  return { own: own.filter((b) => !isSetup(b)), others: others.filter((b) => !isSetup(b)), setup };
}

export interface Tab {
  label: string;
  icon: IconName;
  route: Route;
}

/**
 * Bottom bar: the built tabs this user may open. A phone shows at most four
 * items plus "Más" (App Plan); when there are more, the fourth slot is "Más"
 * and holds the rest, with "Salir". Otherwise "Salir" sits in the bar.
 */
export function navigation(permissions: readonly string[]): { bar: Tab[]; more: Tab[] } {
  const all: Array<Tab & { permission?: string }> = [
    { label: "Inicio", icon: "home", route: "/" },
    { label: "Censo", icon: "list", route: "/censo", permission: "census:view" },
    { label: "Usuarios", icon: "people", route: "/usuarios", permission: "users:manage" },
    { label: "Historial", icon: "clock", route: "/historial", permission: "log:view" },
    { label: "Configuración", icon: "gear", route: "/configuracion", permission: "settings:edit" },
  ];
  const visible = all
    .filter((tab) => !tab.permission || permissions.includes(tab.permission))
    .map(({ label, icon, route }) => ({ label, icon, route }));
  return visible.length <= 4 ? { bar: visible, more: [] } : { bar: visible.slice(0, 3), more: visible.slice(3) };
}

/** Which tab a screen belongs to, so the bar lights the right one. */
export function tabOf(route: Route): Route {
  return route.startsWith("/censo") ? "/censo" : route;
}
