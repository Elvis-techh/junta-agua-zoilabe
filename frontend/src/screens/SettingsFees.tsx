import { useCallback, useEffect, useState } from "react";

import { api } from "../api.ts";
import { formatLempiras, parseLempiras } from "../census.ts";
import { ConfirmPin } from "../components/ConfirmPin.tsx";
import { Dialog } from "../components/Dialog.tsx";
import { MonthField } from "../components/CalendarField.tsx";
import { Icon } from "../icons.tsx";

type FeeKind = "base_monthly" | "late_fee" | "reconnection";

interface Rate {
  id: number;
  amountCentavos: number;
  startsOn: string;
  createdAt: string;
  createdByName: string | null;
  /** False once a payment has been made at this amount. */
  correctable: boolean;
}

interface Fee {
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
 * Configuración → Cuotas. A new amount never replaces an old one: it is added
 * from the month it starts, so past months keep the price they were charged
 * at. An amount typed wrong can be corrected, with a reason, until a payment
 * has been made at it.
 */
export function FeesSection() {
  const [fees, setFees] = useState<Fee[] | null>(null);
  const [today, setToday] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
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
        {fees?.map((fee) => {
          const current = fee.rates.find((rate) => rate.id === fee.currentId) ?? null;
          return (
            <div key={fee.kind} className="card stack" style={{ gap: 8 }}>
              <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
                <strong>{FEES[fee.kind].title}</strong>
                {current ? (
                  <span className="status ok">{formatLempiras(current.amountCentavos)}</span>
                ) : (
                  <span className="status warn">Sin monto</span>
                )}
              </div>
              <div className="muted">{FEES[fee.kind].help}</div>

              {fee.rates.length > 0 && (
                <ul className="stack" style={{ gap: 4, margin: 0, paddingLeft: 20 }}>
                  {fee.rates.map((rate) => (
                    <li key={rate.id}>
                      {formatLempiras(rate.amountCentavos)} desde {formatMonth(rate.startsOn)}
                      {rate.startsOn > today ? " — todavía no empieza" : rate.id === fee.currentId ? " — en uso" : ""}
                      {rate.createdByName && <span className="muted"> · {rate.createdByName}</span>}
                      {rate.correctable && (
                        <div style={{ marginTop: 4 }}>
                          <button className="btn" onClick={() => setEditing({ fee, rate })}>
                            <Icon name="edit" /> Corregir
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <div className="row">
                <button className="btn" onClick={() => setEditing({ fee, rate: null })}>
                  <Icon name="edit" /> {fee.rates.length === 0 ? "Poner monto" : "Cambiar monto"}
                </button>
              </div>
            </div>
          );
        })}
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
    </section>
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
    if (amountCentavos === null) {
      setError("Escriba el monto en lempiras, por ejemplo 70 o 70.50. Si no se cobra, escriba 0.");
    } else if (!startsOn) {
      setError("Elija el mes en que empieza.");
    } else if (!rate && fee.earliestStart && startsOn < fee.earliestStart) {
      setError(`Un cambio empieza en ${formatMonth(fee.earliestStart)} o después.`);
    } else if (rate && reason.trim().length < 5) {
      setError("Escriba por qué se corrige.");
    } else {
      setError(null);
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
              escribió mal; si la junta cambió el monto, use «Cambiar monto».
            </p>
          )}
          <label>
            {rate ? "Monto correcto, en lempiras" : "Monto, en lempiras"}
            <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="Ejemplo: 70" autoFocus />
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
