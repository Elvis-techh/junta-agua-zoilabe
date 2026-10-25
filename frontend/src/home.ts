import type { IconName } from "./icons.tsx";

export type Route =
  | "/"
  | "/usuarios"
  | "/historial"
  | "/censo"
  | "/censo/buscar"
  | "/censo/registrar"
  | "/configuracion"
  | `/censo/vivienda/${string}`;

/** The screen for an address, or Inicio for one this app does not have. */
export function routeOf(path: string): Route {
  const fixed: Route[] = ["/usuarios", "/historial", "/censo", "/censo/buscar", "/censo/registrar", "/configuracion"];
  if ((fixed as string[]).includes(path)) {
    return path as Route;
  }
  if (/^\/censo\/vivienda\/[0-9a-f-]{36}$/.test(path)) {
    return path as Route;
  }
  return "/";
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
  cobrar: { label: "Cobrar", icon: "cash" },
  gasto: { label: "Gasto", icon: "receipt" },
  resumen: { label: "Resumen del mes", icon: "chart" },
  quienDebe: { label: "Quién debe", icon: "alert" },
  aprobar: { label: "Aprobar cierre", icon: "check" },
  reportes: { label: "Reportes", icon: "print" },
  historial: { label: "Historial", icon: "clock", route: "/historial", permission: "log:view" },
  usuarios: { label: "Usuarios", icon: "people", route: "/usuarios", permission: "users:manage" },
  permisos: { label: "Permisos", icon: "key" },
  configuracion: { label: "Configuración", icon: "gear", route: "/configuracion", permission: "settings:edit" },
} satisfies Record<string, HomeButton>;

/** The home screen's large buttons for each role (App Plan, "Screens and navigation"). */
export const HOME_BUTTONS: Record<string, HomeButton[]> = {
  secretario: [B.registrar, B.buscar, B.lista],
  tesorero: [B.cobrar, B.gasto, B.resumen, B.quienDebe],
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
