import { useCallback, useEffect, useState } from "react";

import { api } from "../api.ts";
import { formatLempiras, parseLempiras } from "../census.ts";
import { AmountInput } from "../components/AmountInput.tsx";
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
  /** False once a payment falls in this amount's months: it can then be neither corrected nor removed. */
  correctable: boolean;
}

export interface Fee {
  kind: FeeKind;
  currentId: number | null;
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

/** "2027-01-01" → "2026-12-01". */
function monthBefore(firstDay: string): string {
  const year = Number(firstDay.slice(0, 4));
  const month = Number(firstDay.slice(5, 7));
  return month === 1 ? `${year - 1}-12-01` : `${year}-${String(month - 1).padStart(2, "0")}-01`;
}

/**
 * What a new amount starting in a past month does, in the words the summary
 * shows: the unpaid months from then until the next amount cost it. Null for
 * a change from this month on, which needs no warning.
 */
export function pastStartEffect(fee: Fee, startsOn: string, today: string): string | null {
  if (startsOn >= `${today.slice(0, 7)}-01`) {
    return null;
  }
  // Newest start first: the last later one is the amount right after it.
  const next = fee.rates.filter((other) => other.startsOn > startsOn).at(-1);
  const until = next ? ` hasta ${formatMonth(monthBefore(next.startsOn))}` : " en adelante";
  return `Empieza en un mes pasado: los meses sin pagar desde ${formatMonth(startsOn)}${until} se cobran con este monto.`;
}

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
 * What is wrong with the form, said before "¿Está correcto?", or null.
 * The server checks all of it again; a month already taken would otherwise
 * only show up after "Sí, guardar".
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
 * from the month it starts, up to the next amount. It may start in a past
 * month, for the fees of the years in the paper book, unless a payment falls
 * in the months it would cover; the server says so. Until a payment falls in
 * its months, an amount can be corrected if it was typed wrong, or removed if
 * the board did not mean it, with a reason.
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
        La junta decide los montos. Cada monto cuenta desde el mes que se elija hasta que empiece el siguiente. Un
        mes que ya tiene pagos no cambia de monto.
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
 * what its months go back to and asks why. The server keeps the amount,
 * marked removed, and the history shows who and why.
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
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const check = () => {
    if (reason.trim().length < 5) {
      setError("Escriba por qué se quita.");
      return;
    }
    void remove();
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
      <p className="muted">Queda en el historial y no se puede borrar.</p>
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
  const [month, setMonth] = useState(today.slice(0, 7));
  const [reason, setReason] = useState("");
  const [step, setStep] = useState<"form" | "confirm">("form");
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
            <>
              <p>
                {title} será <strong>{formatLempiras(amountCentavos!)}</strong> desde{" "}
                <strong>{formatMonth(startsOn!)}</strong>.
              </p>
              {pastStartEffect(fee, startsOn!, today) && <p>{pastStartEffect(fee, startsOn!, today)}</p>}
            </>
          )}
          <p className="muted">Queda en el historial y no se puede borrar.</p>
          <div className="row">
            <button className="btn go" disabled={saving} onClick={() => void save()}>
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
                <MonthField value={month} onChange={setMonth} />
              </label>
              <p className="muted">Puede ser un mes pasado, para los montos de años anteriores.</p>
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
