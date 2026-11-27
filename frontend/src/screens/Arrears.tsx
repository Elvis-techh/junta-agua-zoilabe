import { useEffect, useState } from "react";

import { api } from "../api.ts";
import { formatLempiras } from "../census.ts";
import { BackButton } from "../components/BackButton.tsx";
import type { Go } from "../components/Shell.tsx";
import { Icon } from "../icons.tsx";
import { useLive, useNewest } from "../live.ts";
import { monthName, shortMonth } from "../payments.ts";

/** Under the summary: a house without service is still listed for what it owes from before. */
const SERVICE_NOTE = "Una vivienda inactiva o sin conexión aparece por los meses en que tenía el servicio.";

/** One month of a house on the list: what is left of its fee, and its late fee (0 when none). */
export interface ArrearsMonth {
  month: string;
  owedCentavos: number;
  lateFeeCentavos: number;
}

export interface ArrearsHouse {
  id: string;
  code: string;
  /** Today's, as the census says: a house that owes is listed whatever it is now. */
  status: "active" | "inactive";
  waterConnection: "connected" | "not_connected" | "shared";
  ownerName: string;
  sectorName: string;
  months: ArrearsMonth[];
  owedCentavos: number;
  lateFeesCentavos: number;
  totalCentavos: number;
}

export interface Arrears {
  today: string;
  lateFeesFrom: string | null;
  households: ArrearsHouse[];
  owedCentavos: number;
  lateFeesCentavos: number;
  totalCentavos: number;
}

/** "Octubre 2026: L 70.00 de cuota y L 50.00 de mora", "Julio 2026: solo la mora, L 50.00". */
export function arrearsMonthLine(month: ArrearsMonth): string {
  const name = `${shortMonth(month.month)} ${month.month.slice(0, 4)}`;
  if (month.owedCentavos === 0) return `${name}: solo la mora, ${formatLempiras(month.lateFeeCentavos)} (la cuota se pagó tarde)`;
  if (month.lateFeeCentavos === 0) return `${name}: ${formatLempiras(month.owedCentavos)} de cuota`;
  return `${name}: ${formatLempiras(month.owedCentavos)} de cuota y ${formatLempiras(month.lateFeeCentavos)} de mora`;
}

/** "Inactiva", "Sin conexión" or both: why a house that owes no longer builds up debt. Null for one with service. */
export function arrearsMark(house: Pick<ArrearsHouse, "status" | "waterConnection">): string | null {
  const noWater = house.waterConnection === "not_connected";
  if (house.status === "inactive") return noWater ? "Inactiva, sin conexión" : "Inactiva";
  return noWater ? "Sin conexión" : null;
}

/** The line at the top: how many houses owe, and how much in all. */
export function arrearsSummary(list: Arrears): string {
  const count = list.households.length;
  if (count === 0) return "Ninguna vivienda debe.";
  const houses = count === 1 ? "1 vivienda debe" : `${count} viviendas deben`;
  return list.lateFeesCentavos > 0
    ? `${houses} ${formatLempiras(list.totalCentavos)}: ${formatLempiras(list.owedCentavos)} de cuotas y ${formatLempiras(list.lateFeesCentavos)} de mora.`
    : `${houses} ${formatLempiras(list.totalCentavos)} de cuotas.`;
}

/**
 * Quién debe (App Plan, Module 2, "Arrears"): every house that owes, the
 * most owed first, each with its months and the late fee owed for each. An
 * inactive house, or one without water, is marked (owner, 19 November 2026).
 * A tap opens the house's file, to collect from there. The server works it
 * all out (backend/src/routes/arrears.ts). A cargo that may not see the
 * census reads the same list, and its houses do not open.
 */
export function ArrearsScreen({ onOpen, canOpenHouse, canCollect }: { onOpen: Go; canOpenHouse: boolean; canCollect: boolean }) {
  const [list, setList] = useState<Arrears | null>(null);
  const [error, setError] = useState<string | null>(null);

  const live = useLive();
  const newest = useNewest();
  useEffect(() => {
    void newest(api<Arrears>("GET", "/finance/arrears"), setList, (err) => setError(err.message));
  }, [live, newest]);

  return (
    <main className="screen stack">
      <BackButton onClick={() => onOpen("/")} />
      <h1>Quién debe</h1>
      {!list && <p className={error ? "message error" : "muted"}>{error ?? "Cargando…"}</p>}
      {list && (
        <>
          <p style={{ margin: 0 }}>
            <strong>{arrearsSummary(list)}</strong>
          </p>
          <p className="muted" style={{ margin: 0 }}>
            {list.lateFeesFrom
              ? `La mora se cuenta sola desde ${monthName(list.lateFeesFrom)}. ${SERVICE_NOTE}`
              : `La mora todavía no se cuenta sola: falta poner desde qué mes en Configuración → Mora. ${SERVICE_NOTE}`}
          </p>
          {list.households.map((house) => {
            const mark = arrearsMark(house);
            const inside = (
              <>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <strong>{house.code}</strong>
                  <strong style={{ whiteSpace: "nowrap" }}>{formatLempiras(house.totalCentavos)}</strong>
                </div>
                {mark && (
                  <span className="status warn" style={{ justifySelf: "start" }}>
                    <Icon name="alert" size={18} /> {mark}
                  </span>
                )}
                <div>{house.ownerName}</div>
                <div className="muted">{house.sectorName}</div>
                {house.months.slice(0, 6).map((month) => (
                  <div key={month.month}>{arrearsMonthLine(month)}</div>
                ))}
                {house.months.length > 6 && <div className="muted">y {house.months.length - 6} meses más</div>}
              </>
            );
            return canOpenHouse ? (
              <button key={house.id} className="card household-card" onClick={() => onOpen(`/censo/vivienda/${house.id}`)}>
                {inside}
              </button>
            ) : (
              <div key={house.id} className="card household-card" style={{ cursor: "default" }}>
                {inside}
              </div>
            );
          })}
          {canCollect && list.households.length > 0 && (
            <button className="btn block" onClick={() => onOpen("/finanzas/cobrar")}>
              <Icon name="cash" /> Cobrar
            </button>
          )}
        </>
      )}
    </main>
  );
}
