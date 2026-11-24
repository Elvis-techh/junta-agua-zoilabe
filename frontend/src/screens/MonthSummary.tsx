import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { ApiError, api } from "../api.ts";
import { BackButton } from "../components/BackButton.tsx";
import { Dialog } from "../components/Dialog.tsx";
import type { Go } from "../components/Shell.tsx";
import { formatLempiras } from "../census.ts";
import { photoAddress } from "../expenses.ts";
import { Icon } from "../icons.tsx";
import { monthTitle } from "../monthClose.ts";
import type { FeeHouse, MonthSummary, SummaryEntry, SummaryPart } from "../monthSummary.ts";
import { MonthStatementPart } from "./MonthStatement.tsx";
import {
  dayName,
  entryDetails,
  entryGroups,
  entryWhat,
  entryWho,
  feeCardLines,
  feeGroups,
  feeHouseLine,
  feeLines,
  houseOwes,
  moneyLines,
  moneyTotal,
  monthWords,
  onlyMonthLine,
  summaryMonths,
  summaryRoute,
  summaryStatus,
  undoneLine,
} from "../monthSummary.ts";

/** An amount or a number stays on one line: "L 250.00" and "Recibo nº 5009", never split at the end of a line. */
const together = (text: string) => text.replace(/\bL /g, "L\u00a0").replace(/nº /g, "nº\u00a0");

/**
 * Resumen del mes (owner, 19 November 2026): a month at a glance, for the
 * board to check what came in and what was spent, who was charged the
 * month's fee, who paid it and who still owes. The summary answers in two
 * cards; each part opens on its own screen, so nobody has to scroll past
 * one list to find another. The server counts it all
 * (backend/src/lib/monthSummary.ts), as Cierre, Quién debe and Lo que debe
 * do.
 */
export function MonthSummaryScreen({ month, part, canHandOut, onOpen }: { month: string | null; part: SummaryPart | null; canHandOut: boolean; onOpen: Go }) {
  const [data, setData] = useState<MonthSummary | null>(null);
  const [error, setError] = useState<{ text: string; code: string } | null>(null);

  useEffect(() => {
    api<MonthSummary>("GET", month ? `/finance/summary/${month}` : "/finance/summary")
      .then(setData)
      .catch((err: Error) => setError({ text: err.message, code: err instanceof ApiError ? err.code : "" }));
  }, [month]);

  const back = part && month ? <BackButton label="Resumen" onClick={() => onOpen(summaryRoute(month))} /> : <BackButton onClick={() => onOpen("/")} />;
  if (!data) {
    return (
      <main className="screen stack">
        {back}
        <h1>Resumen del mes</h1>
        <p className={error ? "message error" : "muted"}>{error?.text ?? "Cargando…"}</p>
        {error?.code === "no_opening_balance" && (
          <button className="btn primary" onClick={() => onOpen("/finanzas/saldo")}>
            <Icon name="chart" /> Saldo de la junta
          </button>
        )}
      </main>
    );
  }
  if (part === "entradas" || part === "gastos") {
    return <EntriesPart summary={data} kind={part === "entradas" ? "income" : "expense"} back={back} />;
  }
  if (part === "cuota") {
    return <FeePart summary={data} back={back} onOpen={onOpen} />;
  }
  if (part === "documento" && canHandOut) {
    return <MonthStatementPart summary={data} canHandOut={canHandOut} back={back} onOpen={onOpen} />;
  }
  return <Summary summary={data} back={back} canHandOut={canHandOut} onOpen={onOpen} />;
}

/**
 * The month on one phone screen: the way back and the close's status, the
 * month's name (tap it for another month), its money, where "Entró" and
 * "Salió" open what came in and what went out, and its fee, which opens
 * who paid and who still owes.
 */
function Summary({ summary, back, canHandOut, onOpen }: { summary: MonthSummary; back: ReactNode; canHandOut: boolean; onOpen: Go }) {
  const [choosing, setChoosing] = useState(false);
  const status = summaryStatus(summary);
  const months = summaryMonths(summary);
  return (
    <main className="screen stack">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        {back}
        <span className={`status ${status.tone}`}>{status.words}</span>
      </div>
      {/* The month's name is the way to another month: one row, so the fee still fits on the screen. */}
      <button className="btn block month-button" onClick={() => setChoosing(true)}>
        <Icon name="calendar" />
        <span className="month-button-name">{monthTitle(summary.month)}</span>
        <span className="month-button-change">Cambiar</span>
      </button>

      {/* "Entró" and "Salió" are the buttons that list them: the figure and its detail in one place. */}
      <div className="card stack" style={{ gap: 6 }}>
        {moneyLines(summary).map((line, index) =>
          index === 1 || index === 2 ? (
            <button
              key={line.label}
              className="btn money-line money-button"
              onClick={() => onOpen(summaryRoute(summary.month, index === 1 ? "entradas" : "gastos"))}
            >
              <Icon name={index === 1 ? "cash" : "receipt"} size={22} />
              <span className="money-button-label">{line.label}</span>
              <span className="amount">{line.amount}</span>
              <Icon name="forward" size={22} />
            </button>
          ) : (
            <div key={line.label} className={`money-line${index === 3 ? " total" : ""}`}>
              <span>{line.label}</span>
              <span className="amount">{line.amount}</span>
            </div>
          ),
        )}
      </div>

      <button className="card household-card" onClick={() => onOpen(summaryRoute(summary.month, "cuota"))}>
        <strong>Cuota de {monthWords(summary.month, summary.thisMonth)}</strong>
        {feeCardLines(summary.fee).map((line) => (
          <div key={line}>{together(line)}</div>
        ))}
        <span className="card-link">
          <Icon name="people" size={22} /> Ver quién pagó y quién falta
        </span>
      </button>

      {canHandOut && (
        <button className="btn block" onClick={() => onOpen(summaryRoute(summary.month, "documento"))}>
          <Icon name="whatsapp" /> Hacer estado para enviar
        </button>
      )}

      {choosing && (
        <Dialog title="¿Qué mes?" onClose={() => setChoosing(false)}>
          {months.length === 1 && <p style={{ margin: 0 }}>{onlyMonthLine(summary)}</p>}
          {months.map((month) => (
            <button
              key={month}
              className={`btn block${month === summary.month ? " primary" : ""}`}
              onClick={() => {
                setChoosing(false);
                onOpen(summaryRoute(month));
              }}
            >
              {monthTitle(month)}
              {month === summary.thisMonth ? " (este mes)" : ""}
            </button>
          ))}
        </Dialog>
      )}
    </main>
  );
}

/** What came in, or what was spent, by category, each entry with whom and what for. */
function EntriesPart({ summary, kind, back }: { summary: MonthSummary; kind: SummaryEntry["kind"]; back: ReactNode }) {
  const [viewing, setViewing] = useState<SummaryEntry | null>(null);
  const groups = entryGroups(summary, kind);
  const income = kind === "income";
  return (
    <main className="screen stack">
      {back}
      <h1 style={{ margin: 0 }}>
        {income ? "Entradas" : "Gastos"} de {monthWords(summary.month, summary.thisMonth)}
      </h1>
      <p style={{ margin: 0 }}>
        <strong>Total: {formatLempiras(moneyTotal(income ? summary.figures.income : summary.figures.expense))}</strong>
      </p>
      {groups.length === 0 && <p className="muted">{income ? "No se anotó ningún ingreso este mes." : "No se anotó ningún gasto este mes."}</p>}
      {groups.map((group) => (
        <section key={group.category} className="stack" style={{ gap: 8 }}>
          <h2 className="money-line" style={{ margin: 0 }}>
            <span>{group.category}</span>
            <span className="amount">{formatLempiras(group.totalCentavos)}</span>
          </h2>
          {group.entries.map((entry) => (
            <EntryCard key={entry.id} entry={entry} month={summary.month} onPhoto={entry.hasPhoto && !entry.undoesOn ? () => setViewing(entry) : undefined} />
          ))}
        </section>
      ))}
      {viewing && (
        <Dialog title="Foto" onClose={() => setViewing(null)}>
          <p style={{ margin: 0 }}>
            {viewing.category}: {formatLempiras(viewing.amountCentavos)} a {viewing.supplier}, {dayName(viewing.occurredOn)}.
          </p>
          <img className="receipt-photo" src={photoAddress(viewing.id)} alt="Foto del recibo o la factura" />
        </Dialog>
      )}
    </main>
  );
}

function EntryCard({ entry, month, onPhoto }: { entry: SummaryEntry; month: string; onPhoto?: (() => void) | undefined }) {
  const what = entryWhat(entry);
  const undone = undoneLine(entry, month);
  return (
    <div className="card stack" style={{ gap: 4 }}>
      <div className="money-line">
        <strong>{entryWho(entry)}</strong>
        <strong className="amount" style={entry.countsCentavos === 0 ? { textDecoration: "line-through" } : undefined}>
          {formatLempiras(entry.amountCentavos)}
        </strong>
      </div>
      {what && <div>{what}</div>}
      <div className="muted">{together(entryDetails(entry, month))}</div>
      {entry.kind === "expense" && !entry.hasPhoto && !entry.undoesOn && (
        <span className="status warn" style={{ justifySelf: "start" }}>
          <Icon name="alert" size={18} /> Sin foto{entry.noPhotoReason ? `: ${entry.noPhotoReason}` : ""}
        </span>
      )}
      {undone && (
        <>
          <span className="status danger" style={{ justifySelf: "start" }}>
            <Icon name="x" size={18} /> {entry.undoesOn ? "Anulación" : "Anulado"}
          </span>
          <div className="muted">{together(undone)}</div>
        </>
      )}
      {onPhoto && (
        <button className="btn" style={{ justifySelf: "start" }} onClick={onPhoto}>
          <Icon name="camera" /> Ver la foto
        </button>
      )}
    </div>
  );
}

/** Every house charged the month's fee: first those who still owe something of it, then those who paid it all. */
function FeePart({ summary, back, onOpen }: { summary: MonthSummary; back: ReactNode; onOpen: Go }) {
  const { fee } = summary;
  const { owing, upToDate } = feeGroups(fee);
  const house = (row: FeeHouse) => (
    <button key={row.id} className="card household-card" onClick={() => onOpen(`/censo/vivienda/${row.id}`)}>
      <div className="money-line">
        <strong>{row.ownerName ?? "Sin nombre"}</strong>
        {houseOwes(row) > 0 ? (
          <strong className="amount">{formatLempiras(houseOwes(row))}</strong>
        ) : (
          <span className="status ok">
            <Icon name="check" size={18} /> Pagó
          </span>
        )}
      </div>
      <div className="muted">
        {row.code}
        {row.sectorName ? ` · ${row.sectorName}` : ""}
      </div>
      <div>{together(feeHouseLine(row, fee.pastDeadline))}</div>
    </button>
  );
  return (
    <main className="screen stack">
      {back}
      <h1 style={{ margin: 0 }}>Cuota de {monthWords(summary.month, summary.thisMonth)}</h1>
      <div className="stack" style={{ gap: 2 }}>
        {feeLines(fee, summary.month).map((line) => (
          <div key={line}>{together(line)}</div>
        ))}
      </div>
      {owing.length > 0 && (
        <>
          <h2 style={{ margin: 0 }}>Faltan de pagar ({owing.length})</h2>
          {owing.map(house)}
        </>
      )}
      {upToDate.length > 0 && (
        <>
          <h2 style={{ margin: 0 }}>Pagaron todo ({upToDate.length})</h2>
          {upToDate.map(house)}
        </>
      )}
      {fee.lateFeesFrom === null && fee.pastDeadline && (
        <p className="muted" style={{ margin: 0 }}>
          La mora todavía no se cuenta sola: falta poner desde qué mes en Configuración → Mora.
        </p>
      )}
    </main>
  );
}
