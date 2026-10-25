import type { IconName } from "./icons.tsx";

export type Route = "/" | "/usuarios" | "/historial";

export interface HomeButton {
  label: string;
  icon: IconName;
  /** Where it goes; absent for the screens later phases build. */
  route?: Route;
  /** The button shows only when the user holds this permission. */
  permission?: string;
}

const B = {
  registrar: { label: "Registrar familia", icon: "house" },
  buscar: { label: "Buscar", icon: "search" },
  lista: { label: "Lista", icon: "list" },
  censo: { label: "Censo", icon: "list" },
  cobrar: { label: "Cobrar", icon: "cash" },
  gasto: { label: "Gasto", icon: "receipt" },
  resumen: { label: "Resumen del mes", icon: "chart" },
  quienDebe: { label: "Quién debe", icon: "alert" },
  aprobar: { label: "Aprobar cierre", icon: "check" },
  reportes: { label: "Reportes", icon: "print" },
  historial: { label: "Historial", icon: "clock", route: "/historial", permission: "log:view" },
  usuarios: { label: "Usuarios", icon: "people", route: "/usuarios", permission: "users:manage" },
  permisos: { label: "Permisos", icon: "key" },
  configuracion: { label: "Configuración", icon: "gear" },
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

/** Bottom bar: Inicio plus the built tabs this user may open — never more than four plus "Salir". */
export function tabs(permissions: readonly string[]): Array<{ label: string; icon: IconName; route: Route }> {
  const all: Array<{ label: string; icon: IconName; route: Route; permission?: string }> = [
    { label: "Inicio", icon: "home", route: "/" },
    { label: "Usuarios", icon: "people", route: "/usuarios", permission: "users:manage" },
    { label: "Historial", icon: "clock", route: "/historial", permission: "log:view" },
  ];
  return all
    .filter((tab) => !tab.permission || permissions.includes(tab.permission))
    .slice(0, 4)
    .map(({ label, icon, route }) => ({ label, icon, route }));
}
