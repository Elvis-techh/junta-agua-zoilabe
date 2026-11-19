import { useCallback, useEffect, useState } from "react";

import { api } from "../api.ts";
import { AmountInput } from "../components/AmountInput.tsx";
import { BackButton } from "../components/BackButton.tsx";
import { Dialog } from "../components/Dialog.tsx";
import type { Go } from "../components/Shell.tsx";
import { formatLempiras, parseLempiras } from "../census.ts";
import { Icon } from "../icons.tsx";
import type { MonthDetail, MonthsData } from "../monthClose.ts";
import { categoryLines, columnAmount, differenceLine, figureRows, monthTitle, readCount, statusWords } from "../monthClose.ts";
import { monthName } from "../payments.ts";
import { formatDate } from "../time.ts";
import { isTouchScreen } from "../viewport.ts";

interface Abilities {
  meId: string;
  canPrepare: boolean;
  canApprove: boolean;
}

/**
 * Cierre del mes (App Plan, Module 2, "Monthly cycle"; owner, 19 November
 * 2026): the oldest month not yet closed, with its figures. Someone counts
 * the cash and taps "Preparar cierre"; someone else taps "Aprobar cierre",
 * or "Devolver" with a reason. Below, the months already closed.
 */
export function MonthCloseScreen({ abilities, onOpen }: { abilities: Abilities; onOpen: Go }) {
  const [data, setData] = useState<MonthsData | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<MonthsData>("GET", "/finance/months"));
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const done = async (text: string) => {
    setMessage({ kind: "ok", text });
    await load();
    window.scrollTo(0, 0);
  };

  const closed = data?.months.filter((row) => row.status === "closed") ?? [];

  return (
    <main className="screen stack">
      {/* The month to close is the title, and its status sits beside the way back: the approver's buttons must fit on a phone. */}
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <BackButton onClick={() => onOpen("/")} />
        {data?.next && (
          <span className={`status ${data.next.row.status === "prepared" ? "warn" : "ok"}`}>{statusWords(data.next.row.status)}</span>
        )}
      </div>
      <h1 style={{ margin: 0 }}>{data?.next ? monthTitle(data.next.row.month) : "Cierre del mes"}</h1>
      {message && <p className={`message ${message.kind}`}>{message.text}</p>}
      {!data && !message && <p className="muted">Cargando…</p>}

      {data && !data.openingMonth && (
        <>
          <p>Primero se anota el Saldo de la junta: el cierre cuenta desde ahí.</p>
          <button className="btn primary" onClick={() => onOpen("/finanzas/saldo")}>
            <Icon name="chart" /> Saldo de la junta
          </button>
        </>
      )}

      {data && data.openingMonth && !data.next && (
        <p className="muted">
          No hay mes por cerrar. El cierre de {monthName(data.thisMonth)} se prepara cuando termine el mes.
        </p>
      )}

      {data?.next && (
        <NextMonth key={`${data.next.row.month}-${data.next.row.status}`} detail={data.next} abilities={abilities} onDone={done} onError={(text) => setMessage({ kind: "error", text })} />
      )}

      {closed.length > 0 && (
        <>
          <h2 style={{ margin: 0 }}>Meses cerrados</h2>
          {closed.map((row) => (
            <button key={row.month} className="card household-card" onClick={() => onOpen(`/finanzas/cierre/${row.month}`)}>
              <strong>{monthTitle(row.month)}</strong>
              <div className="muted">Contado en caja: {formatLempiras(row.cashCountedCentavos ?? 0)}</div>
              {row.cashCountedCentavos !== row.expectedCashCentavos && (
                <div>{differenceLine(row.cashCountedCentavos ?? 0, row.expectedCashCentavos ?? 0)}</div>
              )}
            </button>
          ))}
        </>
      )}
    </main>
  );
}

/** The month to close now: count and prepare it, or approve it or send it back. */
function NextMonth({
  detail,
  abilities,
  onDone,
  onError,
}: {
  detail: MonthDetail;
  abilities: Abilities;
  onDone: (text: string) => Promise<void>;
  onError: (text: string) => void;
}) {
  const { row, figures } = detail;
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [returning, setReturning] = useState(false);
  const expected = figures.expected.cashCentavos;
  const countedCentavos = parseLempiras(counted);
  const name = monthName(row.month);

  const send = async (path: string, body: object, text: string) => {
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/finance/months/${row.month}/${path}`, body);
      await onDone(text);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const prepare = () => {
    const read = readCount(counted, reason, expected);
    if ("problem" in read) {
      setError(read.problem);
      return;
    }
    void send("prepare", read, `Cierre de ${name} preparado. Falta que otra persona lo apruebe.`);
  };

  const isPreparer = row.preparedById === abilities.meId;

  return (
    <>
      {row.status === "open" && row.returnedBy && (
        <p className="message error" style={{ margin: 0 }}>
          Lo devolvió {row.returnedBy}: {row.returnedReason}
        </p>
      )}
      <Figures detail={detail} counted={row.status === "prepared" ? row.cashCountedCentavos : null} />

      {row.status === "open" &&
        (abilities.canPrepare ? (
          <>
            <label>
              Efectivo contado en caja
              <AmountInput value={counted} onChange={setCounted} placeholder="L" />
            </label>
            {countedCentavos !== null && <div>{differenceLine(countedCentavos, expected)}</div>}
            {countedCentavos !== null && countedCentavos !== expected && (
              <label>
                Por qué no cuadra
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ejemplo: se pagó un viaje y no se anotó" />
              </label>
            )}
            {error && <p className="message error">{error}</p>}
            <button className="btn go" disabled={busy} onClick={prepare}>
              <Icon name="check" /> Preparar cierre
            </button>
            <p className="muted" style={{ margin: 0 }}>
              Solo se cuenta el efectivo. El banco se revisa con su estado de cuenta.
            </p>
            <CategoryLines detail={detail} />
          </>
        ) : (
          <p className="muted">Este mes todavía no se ha preparado.</p>
        ))}

      {row.status === "prepared" && (
        <>
          <div className="stack" style={{ gap: 2 }}>
            {row.cashDifferenceReason ? (
              <div>Por qué: {row.cashDifferenceReason}</div>
            ) : (
              <div>{differenceLine(row.cashCountedCentavos ?? 0, row.expectedCashCentavos ?? 0)}</div>
            )}
            {isPreparer && <div className="muted">Usted lo preparó: lo debe aprobar otra persona.</div>}
          </div>
          {error && <p className="message error">{error}</p>}
          {abilities.canApprove && (
            <div className="row">
              {!isPreparer && (
                <button
                  className="btn go"
                  // The usual size, so Devolver fits beside it on a phone.
                  style={{ flex: 1, fontSize: "1rem" }}
                  disabled={busy}
                  onClick={() => void send("approve", {}, `Mes de ${name} cerrado.`)}
                >
                  <Icon name="check" /> Aprobar cierre
                </button>
              )}
              <button className="btn" style={{ flex: "none" }} disabled={busy} onClick={() => setReturning(true)}>
                Devolver
              </button>
            </div>
          )}
          {/* Under the buttons, so they fit on a phone above "Hay más abajo". */}
          {!isPreparer && <div className="muted">Lo preparó {row.preparedBy}.</div>}
          <CategoryLines detail={detail} />
        </>
      )}

      {returning && (
        <ReturnDialog
          month={row.month}
          onClose={() => setReturning(false)}
          onReturned={() => {
            setReturning(false);
            void onDone(`Cierre de ${name} devuelto. El mes queda abierto.`);
          }}
          onError={onError}
        />
      )}
    </>
  );
}

/**
 * The month's figures: Caja and Banco side by side, and once it is
 * prepared, the cash counted under what should be there, with the month's
 * "Faltante" or "Sobrante de caja" when they differ.
 */
function Figures({ detail, counted }: { detail: MonthDetail; counted: number | null }) {
  const { rows, showOther } = figureRows(detail.figures);
  const difference = counted === null ? 0 : counted - detail.figures.expected.cashCentavos;
  return (
    <div className="card">
      <div className={`figures${showOther ? " with-other" : ""}`}>
        <span />
        <span className="head">Caja (L)</span>
        <span className="head">Banco (L)</span>
        {showOther && <span className="head">Otro (L)</span>}
        {rows.map((row, index) => {
          const total = index === rows.length - 1 ? " total" : "";
          return [
            <span key={`${row.label}-label`} className={total.trim()}>
              {row.label}
            </span>,
            <span key={`${row.label}-cash`} className={`amount${total}`}>
              {row.cash}
            </span>,
            <span key={`${row.label}-bank`} className={`amount${total}`}>
              {row.bank}
            </span>,
            showOther ? (
              <span key={`${row.label}-other`} className={`amount${total}`}>
                {row.other}
              </span>
            ) : null,
          ];
        })}
        {counted !== null && [
          <strong key="counted-label">Contado</strong>,
          <strong key="counted-cash" className="amount">
            {columnAmount(counted)}
          </strong>,
          <span key="counted-bank" className="amount muted">
            —
          </span>,
          showOther ? (
            <span key="counted-other" className="amount muted">
              —
            </span>
          ) : null,
        ]}
        {difference !== 0 && [
          <span key="difference-label">{difference < 0 ? "Faltante" : "Sobrante"}</span>,
          <span key="difference-cash" className="amount">
            {columnAmount(Math.abs(difference))}
          </span>,
          <span key="difference-bank" />,
          showOther ? <span key="difference-other" /> : null,
        ]}
      </div>
    </div>
  );
}

/** What each category added up to, on request: under the buttons, since the totals are what is checked first. */
function CategoryLines({ detail }: { detail: MonthDetail }) {
  const [shown, setShown] = useState(false);
  const lines = categoryLines(detail.figures);
  if (lines.length === 0) return null;
  return shown ? (
    <div className="stack" style={{ gap: 2 }}>
      {lines.map((line) => (
        <div key={line} className="muted">
          {line}
        </div>
      ))}
    </div>
  ) : (
    <button className="btn" style={{ justifySelf: "start" }} onClick={() => setShown(true)}>
      <Icon name="list" /> Ver de qué es
    </button>
  );
}

function ReturnDialog({
  month,
  onClose,
  onReturned,
  onError,
}: {
  month: string;
  onClose: () => void;
  onReturned: () => void;
  onError: (text: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (reason.trim().length < 5) {
      setError("Escriba por qué se devuelve.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/finance/months/${month}/return`, { reason: reason.trim() });
      onReturned();
    } catch (err) {
      const text = (err as Error).message;
      setError(text);
      onError(text);
      setBusy(false);
    }
  };

  return (
    <Dialog title={`Devolver el cierre de ${monthName(month)}`} onClose={onClose}>
      <label>
        Por qué se devuelve
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ejemplo: falta anotar el pago de la luz" autoFocus={!isTouchScreen()} />
      </label>
      <p className="muted">El mes queda abierto para corregirlo y prepararlo de nuevo.</p>
      {error && <p className="message error">{error}</p>}
      <div className="row">
        <button className="btn primary" disabled={busy} onClick={() => void save()}>
          <Icon name="back" /> Devolver
        </button>
        <button className="btn" disabled={busy} onClick={onClose}>
          Cancelar
        </button>
      </div>
    </Dialog>
  );
}

/** A month already closed, as it was approved: its figures, what was counted, and who prepared and approved it. */
export function ClosedMonthScreen({ month, onOpen }: { month: string; onOpen: Go }) {
  const [detail, setDetail] = useState<MonthDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<MonthDetail>("GET", `/finance/months/${month}`)
      .then(setDetail)
      .catch((err: Error) => setError(err.message));
  }, [month]);

  const row = detail?.row;
  return (
    <main className="screen stack">
      <BackButton label="Cierre del mes" onClick={() => onOpen("/finanzas/cierre")} />
      <h1>{monthTitle(month)}</h1>
      {!detail && <p className={error ? "message error" : "muted"}>{error ?? "Cargando…"}</p>}
      {detail && row && (
        <>
          <span className={`status ${row.status === "closed" ? "ok" : "warn"}`} style={{ justifySelf: "start" }}>
            {statusWords(row.status)}
          </span>
          <Figures detail={detail} counted={row.cashCountedCentavos} />
          {row.cashCountedCentavos !== null && (
            <div className="stack" style={{ gap: 2 }}>
              {row.cashDifferenceReason ? (
                <div>Por qué: {row.cashDifferenceReason}</div>
              ) : (
                <div>{differenceLine(row.cashCountedCentavos, row.expectedCashCentavos ?? 0)}</div>
              )}
              <div className="muted">
                Lo preparó {row.preparedBy}
                {row.preparedAt ? ` el ${formatDate(row.preparedAt)}` : ""}
                {row.approvedBy ? `; lo aprobó ${row.approvedBy}${row.approvedAt ? ` el ${formatDate(row.approvedAt)}` : ""}` : ""}.
              </div>
            </div>
          )}
          <CategoryLines detail={detail} />
        </>
      )}
    </main>
  );
}
