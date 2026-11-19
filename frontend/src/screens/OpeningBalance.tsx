import { useCallback, useEffect, useState } from "react";

import { api } from "../api.ts";
import type { BalanceData, Figures, OpeningBalance } from "../balance.ts";
import { BALANCE_WHOLE_DIGITS, amountText, moneyLines, openingLine, readFigures } from "../balance.ts";
import { monthLabel } from "../calendar.ts";
import { AmountInput } from "../components/AmountInput.tsx";
import { BackButton } from "../components/BackButton.tsx";
import { MonthField } from "../components/CalendarField.tsx";
import { Dialog } from "../components/Dialog.tsx";
import type { Go } from "../components/Shell.tsx";
import { formatLempiras } from "../census.ts";
import { Icon } from "../icons.tsx";
import { formatDate } from "../time.ts";
import { isTouchScreen } from "../viewport.ts";

/**
 * Saldo de la junta (owner, 17 November 2026): the money the board has now,
 * in the box and in the bank, counted from the opening balance. The
 * treasurer enters that balance once; a wrong one is corrected with a
 * reason until the first month is closed.
 */
export function OpeningBalanceScreen({ canRecord, canCorrect, onOpen }: { canRecord: boolean; canCorrect: boolean; onOpen: Go }) {
  const [data, setData] = useState<BalanceData | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [correcting, setCorrecting] = useState<OpeningBalance | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<BalanceData>("GET", "/finance/opening-balance"));
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const done = async (text: string) => {
    setCorrecting(null);
    setMessage({ kind: "ok", text });
    await load();
  };

  const opening = data?.opening ?? null;
  const current = data?.entries.find((entry) => entry.id === opening?.id);
  const earlier = data?.entries.filter((entry) => entry.id !== opening?.id) ?? [];

  return (
    <main className="screen stack">
      <BackButton onClick={() => onOpen("/")} />
      <h1>Saldo de la junta</h1>
      {message && <p className={`message ${message.kind}`}>{message.text}</p>}
      {!data && !message && <p className="muted">Cargando…</p>}

      {data && !opening && (canRecord ? (
        <EnterOpening thisMonth={data.thisMonth} onSaved={() => void done("Saldo inicial guardado.")} />
      ) : (
        <p className="muted">Todavía no se ha anotado el saldo inicial.</p>
      ))}

      {data && opening && data.money && (
        <>
          <div className="card stack" style={{ gap: 6 }}>
            <h2 style={{ margin: 0 }}>Dinero ahora</h2>
            {moneyLines(data.money).map((line) => (
              <div key={line.label} className="row" style={{ justifyContent: "space-between" }}>
                <span>{line.label}</span>
                <strong>{line.amount}</strong>
              </div>
            ))}
            <div className="muted">
              Desde {monthLabel(data.money.since.slice(0, 7))}: entró {formatLempiras(data.money.incomeCentavos)} y salió{" "}
              {formatLempiras(data.money.expenseCentavos)}.
            </div>
          </div>

          <div className="card stack" style={{ gap: 6 }}>
            <h2 style={{ margin: 0 }}>Saldo inicial</h2>
            <div>{openingLine(opening)}.</div>
            {current && (
              <div className="muted">
                {current.replacesId ? "Corregido" : "Anotado"}
                {current.createdBy ? ` por ${current.createdBy}` : ""} el {formatDate(current.createdAt)}
                {current.reason ? `. Motivo: ${current.reason}` : ""}.
              </div>
            )}
            {earlier.map((entry) => (
              <div key={entry.id} className="muted">
                Antes: {openingLine(entry)}.
              </div>
            ))}
            {data.closedMonth ? (
              <div className="muted">El mes de {monthLabel(data.closedMonth.slice(0, 7))} ya está cerrado: el saldo inicial ya no se corrige.</div>
            ) : (
              canCorrect && (
                <div className="row">
                  <button className="btn" onClick={() => setCorrecting(opening)}>
                    <Icon name="edit" /> Corregir
                  </button>
                </div>
              )
            )}
          </div>
          <p className="muted">
            Los pagos anotados con fecha de antes de {monthLabel(opening.month.slice(0, 7))} ya están dentro del saldo inicial: solo cuentan
            para lo que debe cada vivienda.
          </p>
        </>
      )}

      {correcting && data && (
        <CorrectOpening
          opening={correcting}
          thisMonth={data.thisMonth}
          onClose={() => setCorrecting(null)}
          onSaved={() => void done("Saldo inicial corregido.")}
        />
      )}
    </main>
  );
}

/** The three answers both forms ask: the month, and the cash and bank on its first day. */
function FiguresFields({ figures, thisMonth, onChange }: { figures: Figures; thisMonth: string; onChange: (figures: Figures) => void }) {
  return (
    <>
      <label>
        Mes en que empieza
        <MonthField value={figures.month} max={thisMonth.slice(0, 7)} onChange={(month) => onChange({ ...figures, month })} />
      </label>
      <div className="row">
        <label style={{ flex: 1, minWidth: 130 }}>
          Efectivo en caja
          <AmountInput
            value={figures.cash}
            onChange={(cash) => onChange({ ...figures, cash })}
            wholeDigits={BALANCE_WHOLE_DIGITS}
            placeholder="L"
          />
        </label>
        <label style={{ flex: 1, minWidth: 130 }}>
          En el banco
          <AmountInput
            value={figures.bank}
            onChange={(bank) => onChange({ ...figures, bank })}
            wholeDigits={BALANCE_WHOLE_DIGITS}
            placeholder="L"
          />
        </label>
      </div>
    </>
  );
}

function EnterOpening({ thisMonth, onSaved }: { thisMonth: string; onSaved: () => void }) {
  const [figures, setFigures] = useState<Figures>({ month: thisMonth.slice(0, 7), cash: "", bank: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const read = readFigures(figures, thisMonth);
    if ("problem" in read) {
      setError(read.problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/finance/opening-balance", read);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div>Anote una sola vez el dinero que tenía la junta el primer día de un mes. Desde ahí, la aplicación suma y resta sola.</div>
      <FiguresFields figures={figures} thisMonth={thisMonth} onChange={setFigures} />
      {error && <p className="message error">{error}</p>}
      <button className="btn primary" disabled={busy} onClick={() => void save()}>
        <Icon name="check" /> Guardar saldo inicial
      </button>
    </div>
  );
}

function CorrectOpening({
  opening,
  thisMonth,
  onClose,
  onSaved,
}: {
  opening: OpeningBalance;
  thisMonth: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [figures, setFigures] = useState<Figures>({
    month: opening.month.slice(0, 7),
    cash: amountText(opening.cashCentavos),
    bank: amountText(opening.bankCentavos),
  });
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const read = readFigures(figures, thisMonth);
    if ("problem" in read) {
      setError(read.problem);
      return;
    }
    if (reason.trim().length < 5) {
      setError("Escriba por qué se corrige.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/finance/opening-balance/${opening.id}/correct`, { ...read, reason: reason.trim() });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog title="Corregir el saldo inicial" onClose={onClose}>
      <FiguresFields figures={figures} thisMonth={thisMonth} onChange={setFigures} />
      <label>
        Por qué se corrige
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ejemplo: contamos la caja de nuevo" autoFocus={!isTouchScreen()} />
      </label>
      <p className="muted">No se borra: el saldo de antes queda anotado, y los dos quedan en el historial.</p>
      {error && <p className="message error">{error}</p>}
      <div className="row">
        <button className="btn primary" disabled={busy} onClick={() => void save()}>
          <Icon name="check" /> Guardar corrección
        </button>
        <button className="btn" disabled={busy} onClick={onClose}>
          <Icon name="back" /> Volver
        </button>
      </div>
    </Dialog>
  );
}
