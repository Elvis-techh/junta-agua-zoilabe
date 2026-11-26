import type { Route } from "./home.ts";
import type { IconName } from "./icons.tsx";

/**
 * One report on Reportes: where it is made, and what it is for, in the
 * village's words. The report itself stays on its own screen; Reportes only
 * gathers them in one place (owner, 26 November 2026).
 */
export interface Report {
  title: string;
  /** One line saying what it is for, and how to get it when it takes a step more. */
  about: string;
  icon: IconName;
  route: Route;
  /**
   * Every permission its screen needs, the same the Shell checks before
   * opening it. The server checks them again on the report's own routes.
   */
  permissions: readonly string[];
}

/**
 * The reports the app makes today (App Plan, "Configuration and reports").
 * The frozen yearly census snapshot is not here: it waits for the board's
 * answers.
 */
export const REPORTS: readonly Report[] = [
  {
    title: "Lista del censo",
    about: "Las familias por sector y estado, para imprimir o guardar para Excel.",
    icon: "list",
    route: "/censo/lista",
    permissions: ["census:view", "export:census"],
  },
  {
    title: "Estado de cuenta de una familia",
    about: "Lo que una familia ha pagado y lo que debe. Busque la familia, abra su vivienda y toque «Estado de cuenta».",
    icon: "paper",
    route: "/censo/buscar",
    permissions: ["census:view", "finance:view", "export:finance"],
  },
  {
    title: "Estado financiero del mes",
    about: "El dinero del mes, para enviar por WhatsApp o guardar. Escoja el mes y toque «Hacer estado para enviar».",
    icon: "chart",
    route: "/finanzas/resumen",
    permissions: ["finance:view", "export:finance"],
  },
  {
    title: "Quién debe",
    about: "Las familias que deben, la que más debe primero.",
    icon: "alert",
    route: "/finanzas/quien-debe",
    permissions: ["finance:view"],
  },
  {
    title: "Historial del año",
    about: "Lo que se hizo en la junta en un año, para imprimir o guardar para Excel.",
    icon: "clock",
    route: "/historial/ano",
    permissions: ["log:view", "export:log"],
  },
];

/** The reports this person may open: those whose every permission they hold. */
export function reportsFor(permissions: readonly string[]): Report[] {
  return REPORTS.filter((report) => report.permissions.every((code) => permissions.includes(code)));
}
