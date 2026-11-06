import { useCallback, useEffect, useState } from "react";

import { api } from "../api.ts";
import { formatLempiras, parseLempiras } from "../census.ts";
import { AmountInput } from "../components/AmountInput.tsx";
import { ConfirmPin } from "../components/ConfirmPin.tsx";
import { Dialog } from "../components/Dialog.tsx";
import { MonthField } from "../components/CalendarField.tsx";
import { Icon } from "../icons.tsx";
import { isTouchScreen } from "../viewport.ts";

type FeeKind = "base_monthly" | "late_fee" | "reconnection";

export interface Rate {
  id: number;
  amountCentavos: number;
  startsOn: string;
  createdAt: string;
  createdByName: string | null;
  /** False once a payment has been made at this amount: it can then be neither corrected nor removed. */
  correctable: boolean;
}

export interface Fee {
  kind: FeeKind;
  currentId: number | null;
  /** "YYYY-MM-01", or null when the first amount may start in any month. */
  earliestStart: string | null;
  /** Newest start first. */
  rates: Rate[];
}

const FEES: Record<FeeKind, { title: string; help: string }> = {
  base_monthly: {
    title: "Cuota mensual base",
    help: "Lo que paga cada vivienda al mes, salvo las que tienen un monto distinto.",
  },
  late_fee: {
    title: "Mora",
    help: "El recargo por cada mes que no se pagó completo antes de su último día.",
  },
  reconnection: {
    title: "Reconexión",
    help: "Lo que se cobra por volver a conectar el agua.",
  },
};

/** "2027-01-01" → "enero de 2027". */
function formatMonth(firstDay: string): string {
  return new Intl.DateTimeFormat("es-HN", { timeZone: "UTC", month: "long", year: "numeric" }).format(
    new Date(`${firstDay}T12:00:00Z`),
  );
}

/** A new amount for a fee, or a correction of one already saved. */
type Editing = { fee: Fee; rate: null } | { fee: Fee; rate: Rate };

/**
 * What removing `rate` does to its months, in the words the dialog shows:
 * they go back to the amount before it, or are left with none, until the
 * next amount (if any) starts.
 */
export function removalEffect(fee: Fee, rate: Rate): string {
  // Newest start first: the first older one is the amount before it.
  const before = fee.rates.find((other) => other.startsOn < rate.startsOn);
  const next = fee.rates.filter((other) => other.startsOn > rate.startsOn).at(-1);
  const until = next ? `, hasta que empiece el de ${formatMonth(next.startsOn)}` : "";
  return before
    ? `Desde ${formatMonth(rate.startsOn)} vuelve a cobrarse ${formatLempiras(before.amountCentavos)}, el monto anterior${until}.`
    : `Desde ${formatMonth(rate.startsOn)} no habrá monto${until}.`;
}

/**
 * What is wrong with the form, said before the PIN is asked for, or null.
 * The server checks all of it again; a month already taken would otherwise
 * only show up after the PIN.
 */
export function feeFormProblem(
  { fee, rate }: Editing,
  form: { amountCentavos: number | null; startsOn: string | null; reason: string },
): string | null {
  if (form.amountCentavos === null) {
    return "Escriba el monto en lempiras, por ejemplo 70 o 70.50. Si no se cobra, escriba 0.";
  }
  if (!form.startsOn) {
    return "Elija el mes en que empieza.";
  }
  if (rate) {
    return form.reason.trim().length < 5 ? "Escriba por qué se corrige." : null;
  }
  if (fee.earliestStart && form.startsOn < fee.earliestStart) {
    return `Un cambio empieza en ${formatMonth(fee.earliestStart)} o después.`;
  }
  if (fee.rates.some((existing) => existing.startsOn === form.startsOn)) {
    return `Ya hay un monto que empieza en ${formatMonth(form.startsOn)}. Si está mal, use «Corregir» en ese monto.`;
  }
  return null;
}

/**
 * One fee: what is in use, then each saved amount in its own box with its own
 * "Corregir" and "Quitar", and below them the button that changes the fee as
 * a whole, so the two kinds of change cannot be taken for each other.
 */
export function FeeCard({
  fee,
  today,
  onEdit,
  onRemove,
}: {
  fee: Fee;
  today: string;
  onEdit: (editing: Editing) => void;
  onRemove: (fee: Fee, rate: Rate) => void;
}) {
  const current = fee.rates.find((rate) => rate.id === fee.currentId) ?? null;
  return (
    <div className="card stack" style={{ gap: 12 }}>
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <strong>{FEES[fee.kind].title}</strong>
        {current ? (
          <span className="status ok">{formatLempiras(current.amountCentavos)}</span>
        ) : (
          <span className="status warn">Sin monto</span>
        )}
      </div>
      <div className="muted">{FEES[fee.kind].help}</div>

      {fee.rates.map((rate) => (
        <div key={rate.id} className="rate-box">
          <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
            <strong>{formatLempiras(rate.amountCentavos)}</strong>
            {rate.startsOn > today ? (
              <span className="status warn">
                <Icon name="clock" size={18} /> Todavía no empieza
              </span>
            ) : rate.id === fee.currentId ? (
              <span className="status ok">
                <Icon name="check" size={18} /> En uso
              </span>
            ) : null}
          </div>
          <div className="row" style={{ gap: "0 12px" }}>
            <span>Desde {formatMonth(rate.startsOn)}</span>
            {rate.createdByName && <span className="muted">{rate.createdByName}</span>}
          </div>
          {rate.correctable && (
            <div className="rate-actions">
              <button className="btn" onClick={() => onEdit({ fee, rate })}>
                <Icon name="edit" /> Corregir
              </button>
              <button className="btn danger" onClick={() => onRemove(fee, rate)}>
                <Icon name="x" /> Quitar
              </button>
            </div>
          )}
        </div>
      ))}

      <button className="btn primary block" onClick={() => onEdit({ fee, rate: null })}>
        <Icon name="edit" /> {fee.rates.length === 0 ? "Poner monto" : "Cambiar detalles"}
      </button>
    </div>
  );
}

/**
 * Configuración → Cuotas. A new amount never replaces an old one: it is added
 * from the month it starts, so past months keep the price they were charged
 * at. Until a payment has been made at an amount, it can be corrected if it
 * was typed wrong, or removed if the board did not mean it, with a reason.
 */
export function FeesSection() {
  const [fees, setFees] = useState<Fee[] | null>(null);
  const [today, setToday] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [removing, setRemoving] = useState<{ fee: Fee; rate: Rate } | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ today: string; fees: Fee[] }>("GET", "/settings/fees");
      setFees(data.fees);
      setToday(data.today);
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="stack">
      <h2>Cuotas</h2>
      <p className="muted">
        La junta decide los montos. Un cambio empieza el mes que se elija y no cambia los meses pasados.
      </p>

      {message && <p className={`message ${message.kind}`}>{message.text}</p>}
      {!fees && !message && <p className="muted">Cargando…</p>}

      <div className="list">
        {fees?.map((fee) => (
          <FeeCard
            key={fee.kind}
            fee={fee}
            today={today}
            onEdit={setEditing}
            onRemove={(shown, rate) => setRemoving({ fee: shown, rate })}
          />
        ))}
      </div>

      {editing && (
        <FeeDialog
          editing={editing}
          today={today}
          onClose={() => setEditing(null)}
          onSaved={async (text) => {
            setEditing(null);
            setMessage({ kind: "ok", text });
            await load();
          }}
        />
      )}

      {removing && (
        <RemoveDialog
          {...removing}
          onClose={() => setRemoving(null)}
          onRemoved={async (text) => {
            setRemoving(null);
            setMessage({ kind: "ok", text });
            await load();
          }}
        />
      )}
    </section>
  );
}

/**
 * "Quitar": an amount the board did not mean, or no longer wants. It says
 * what its months go back to, asks why, then asks for the PIN. The server
 * keeps the amount, marked removed, and the history shows who and why.
 */
function RemoveDialog({
  fee,
  rate,
  onClose,
  onRemoved,
}: {
  fee: Fee;
  rate: Rate;
  onClose: () => void;
  onRemoved: (message: string) => Promise<void>;
}) {
  const title = FEES[fee.kind].title;
  const [reason, setReason] = useState("");
  const [askPin, setAskPin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const check = () => {
    if (reason.trim().length < 5) {
      setError("Escriba por qué se quita.");
      return;
    }
    setError(null);
    setAskPin(true);
  };

  const remove = async () => {
    setSaving(true);
    setError(null);
    try {
      await api("POST", `/settings/fees/${rate.id}/remove`, { reason: reason.trim() });
      await onRemoved(`Se quitó ${formatLempiras(rate.amountCentavos)} desde ${formatMonth(rate.startsOn)} de la ${title.toLowerCase()}.`);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  if (askPin) {
    return (
      <ConfirmPin
        onClose={() => setAskPin(false)}
        onConfirmed={() => {
          setAskPin(false);
          void remove();
        }}
      />
    );
  }

  return (
    <Dialog title="Quitar este monto" onClose={onClose}>
      <p>
        {title}: <strong>{formatLempiras(rate.amountCentavos)}</strong> desde <strong>{formatMonth(rate.startsOn)}</strong>.
      </p>
      <p>{removalEffect(fee, rate)}</p>
      <label>
        Por qué se quita
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ejemplo: la junta no aprobó este aumento"
          autoFocus={!isTouchScreen()}
        />
      </label>
      <p className="muted">Queda en el historial y no se puede borrar. Para quitarlo se pide su PIN.</p>
      {error && <p className="message error">{error}</p>}
      <div className="row">
        <button className="btn primary" disabled={saving} onClick={check}>
          <Icon name="x" /> Quitar monto
        </button>
        <button className="btn" disabled={saving} onClick={onClose}>
          <Icon name="back" /> Volver
        </button>
      </div>
    </Dialog>
  );
}

function FeeDialog({
  editing,
  today,
  onClose,
  onSaved,
}: {
  editing: Editing;
  today: string;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const { fee, rate } = editing;
  const title = FEES[fee.kind].title;
  const [amountText, setAmountText] = useState("");
  // The month field works with "YYYY-MM".
  const [month, setMonth] = useState((fee.earliestStart ?? today).slice(0, 7));
  const [reason, setReason] = useState("");
  const [step, setStep] = useState<"form" | "confirm" | "pin">("form");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const amountCentavos = parseLempiras(amountText);
  const startsOn = rate ? rate.startsOn : /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : null;

  const check = () => {
    const problem = feeFormProblem(editing, { amountCentavos, startsOn, reason });
    setError(problem);
    if (!problem) {
      setStep("confirm");
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (rate) {
        await api("PATCH", `/settings/fees/${rate.id}`, { amountCentavos, reason: reason.trim() });
        await onSaved(`${title} desde ${formatMonth(startsOn!)} corregida: ${formatLempiras(amountCentavos!)}.`);
      } else {
        await api("POST", "/settings/fees", { kind: fee.kind, amountCentavos, startsOn });
        await onSaved(`${title}: ${formatLempiras(amountCentavos!)} desde ${formatMonth(startsOn!)}.`);
      }
    } catch (err) {
      setError((err as Error).message);
      setStep("form");
      setSaving(false);
    }
  };

  if (step === "pin") {
    return (
      <ConfirmPin
        onClose={() => setStep("confirm")}
        onConfirmed={() => {
          setStep("confirm");
          void save();
        }}
      />
    );
  }

  return (
    <Dialog title={rate ? `Corregir ${title.toLowerCase()}` : title} onClose={onClose}>
      {step === "confirm" ? (
        <>
          {rate ? (
            <p>
              {title} desde <strong>{formatMonth(startsOn!)}</strong> pasa de {formatLempiras(rate.amountCentavos)} a{" "}
              <strong>{formatLempiras(amountCentavos!)}</strong>.
            </p>
          ) : (
            <p>
              {title} será <strong>{formatLempiras(amountCentavos!)}</strong> desde{" "}
              <strong>{formatMonth(startsOn!)}</strong>.
            </p>
          )}
          <p className="muted">Queda en el historial y no se puede borrar. Para guardar se pide su PIN.</p>
          <div className="row">
            <button className="btn go" disabled={saving} onClick={() => setStep("pin")}>
              <Icon name="check" /> Sí, guardar
            </button>
            <button className="btn" disabled={saving} onClick={() => setStep("form")}>
              <Icon name="back" /> Volver
            </button>
          </div>
        </>
      ) : (
        <>
          {rate && (
            <p>
              Ahora: {formatLempiras(rate.amountCentavos)} desde {formatMonth(rate.startsOn)}. Se corrige solo si se
              escribió mal; si la junta cambió el monto, use «Cambiar detalles».
            </p>
          )}
          <label>
            {rate ? "Monto correcto, en lempiras" : "Monto, en lempiras"}
            <AmountInput value={amountText} onChange={setAmountText} placeholder="Ejemplo: 70" autoFocus={!isTouchScreen()} />
          </label>
          {rate ? (
            <label>
              Por qué se corrige
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ejemplo: se escribió 7 en vez de 70" />
            </label>
          ) : (
            <>
              <label>
                Desde el mes
                <MonthField value={month} min={fee.earliestStart?.slice(0, 7)} onChange={setMonth} />
              </label>
              <p className="muted">
                {fee.earliestStart
                  ? `Los meses pasados se quedan con el monto que tenían, así que el cambio empieza en ${formatMonth(fee.earliestStart)} o después.`
                  : "Es el primer monto. Puede empezar en un mes pasado, para contar lo que las viviendas ya deben según el cuaderno de recibos."}
              </p>
            </>
          )}
          {error && <p className="message error">{error}</p>}
          <div className="row">
            <button className="btn primary" onClick={check}>
              Seguir
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
