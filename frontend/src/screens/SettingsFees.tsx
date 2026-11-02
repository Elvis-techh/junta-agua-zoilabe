import { useCallback, useEffect, useState } from "react";

import { api } from "../api.ts";
import { formatLempiras, parseLempiras } from "../census.ts";
import { Dialog } from "../components/Dialog.tsx";
import { Icon } from "../icons.tsx";

type FeeKind = "base_monthly" | "late_fee" | "reconnection";

interface Rate {
  id: number;
  amountCentavos: number;
  startsOn: string;
  createdAt: string;
  createdByName: string | null;
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

/**
 * Configuración → Cuotas. A new amount never replaces an old one: it is added
 * from the month it starts, so every month keeps the price it was charged at.
 */
export function FeesSection() {
  const [fees, setFees] = useState<Fee[] | null>(null);
  const [today, setToday] = useState("");
  const [changing, setChanging] = useState<Fee | null>(null);
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
        La junta decide los montos. Un cambio empieza el mes que se elija y no cambia los meses que ya empezaron.
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
                    </li>
                  ))}
                </ul>
              )}

              <div className="row">
                <button className="btn" onClick={() => setChanging(fee)}>
                  <Icon name="edit" /> {fee.rates.length === 0 ? "Poner monto" : "Cambiar monto"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {changing && (
        <ChangeFee
          fee={changing}
          today={today}
          onClose={() => setChanging(null)}
          onSaved={async (text) => {
            setChanging(null);
            setMessage({ kind: "ok", text });
            await load();
          }}
        />
      )}
    </section>
  );
}

function ChangeFee({
  fee,
  today,
  onClose,
  onSaved,
}: {
  fee: Fee;
  today: string;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const title = FEES[fee.kind].title;
  const [amountText, setAmountText] = useState("");
  // `<input type="month">` works with "YYYY-MM".
  const [month, setMonth] = useState((fee.earliestStart ?? today).slice(0, 7));
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const amountCentavos = parseLempiras(amountText);
  const startsOn = /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : null;

  const check = () => {
    if (amountCentavos === null || amountCentavos <= 0) {
      setError("Escriba el monto en lempiras, por ejemplo 70 o 70.50.");
    } else if (!startsOn) {
      setError("Elija el mes en que empieza.");
    } else if (fee.earliestStart && startsOn < fee.earliestStart) {
      setError(`Un cambio empieza en ${formatMonth(fee.earliestStart)} o después.`);
    } else {
      setError(null);
      setConfirming(true);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api("POST", "/settings/fees", { kind: fee.kind, amountCentavos, startsOn });
      await onSaved(`${title}: ${formatLempiras(amountCentavos!)} desde ${formatMonth(startsOn!)}.`);
    } catch (err) {
      setError((err as Error).message);
      setConfirming(false);
      setSaving(false);
    }
  };

  return (
    <Dialog title={title} onClose={onClose}>
      {confirming ? (
        <>
          <p>
            {title} será <strong>{formatLempiras(amountCentavos!)}</strong> desde{" "}
            <strong>{formatMonth(startsOn!)}</strong>.
          </p>
          <p className="muted">
            Queda en el historial y no se puede borrar. Si hay un error, se corrige con otro cambio que empiece en un mes
            siguiente.
          </p>
          <div className="row">
            <button className="btn go" disabled={saving} onClick={() => void save()}>
              <Icon name="check" /> Sí, guardar
            </button>
            <button className="btn" disabled={saving} onClick={() => setConfirming(false)}>
              <Icon name="back" /> Volver
            </button>
          </div>
        </>
      ) : (
        <>
          <label>
            Monto, en lempiras
            <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="Ejemplo: 70" autoFocus />
          </label>
          <label>
            Desde el mes
            <input type="month" value={month} min={fee.earliestStart?.slice(0, 7)} onChange={(e) => setMonth(e.target.value)} />
          </label>
          <p className="muted">
            {fee.earliestStart
              ? `Los meses que ya empezaron se quedan con el monto que tenían, así que el cambio empieza en ${formatMonth(fee.earliestStart)} o después.`
              : "Es el primer monto. Puede empezar en un mes pasado, para contar lo que las viviendas ya deben según el cuaderno de recibos."}
          </p>
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
