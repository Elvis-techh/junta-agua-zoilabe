import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../api.ts";
import { monthLabel } from "../calendar.ts";
import { MonthField } from "../components/CalendarField.tsx";
import { Icon } from "../icons.tsx";
import { useLive, useNewest } from "../live.ts";
import { dueSoonLine } from "../payments.ts";
import { formatDate } from "../time.ts";

interface Deadline {
  dueDay: number;
  graceDays: number;
}

/** The deadline of the month `today` is in, as the server works it out (backend/src/lib/settings.ts). */
export function deadlineExample(today: string, rule: Deadline): string {
  const year = Number(today.slice(0, 4));
  const index = Number(today.slice(5, 7)) - 1;
  const lastDay = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
  const due = new Date(Date.UTC(year, index, Math.min(rule.dueDay, lastDay)));
  const late = new Date(due.getTime() + rule.graceDays * 86_400_000);
  return dueSoonLine({
    month: `${today.slice(0, 7)}-01`,
    dueOn: due.toISOString().slice(0, 10),
    lateAfter: late.toISOString().slice(0, 10),
  });
}

/**
 * Configuración → Plazo de pago (owner, 13 November 2026): the day of each
 * month by which its fee is paid, and the grace days after it. A month not
 * paid in full shows as "Debe el mes de …" once both are over. Each change
 * is kept and logged; the newest applies to every month.
 */
export function DeadlineSection() {
  const [today, setToday] = useState<string | null>(null);
  const [dueDay, setDueDay] = useState("");
  const [graceDays, setGraceDays] = useState("");
  const [saved, setSaved] = useState<{ savedAt: string; savedBy: string | null } | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  /** What the fields were last filled with: one that still holds it was not typed in. */
  const filled = useRef({ dueDay: "", graceDays: "" });

  const newest = useNewest();
  const load = useCallback(
    () =>
      newest(
        api<{ today: string; deadline: Deadline; saved: { savedAt: string; savedBy: string | null } | null }>(
          "GET",
          "/settings/deadline",
        ),
        (data) => {
          setToday(data.today);
          const before = filled.current;
          const now = { dueDay: String(data.deadline.dueDay), graceDays: String(data.deadline.graceDays) };
          filled.current = now;
          // Read again after a live change, a field being typed in keeps what is in it.
          setDueDay((typed) => (typed === before.dueDay ? now.dueDay : typed));
          setGraceDays((typed) => (typed === before.graceDays ? now.graceDays : typed));
          setSaved(data.saved);
        },
        (err) => setMessage({ kind: "error", text: err.message }),
      ),
    [newest],
  );

  const live = useLive();
  useEffect(() => {
    void load();
  }, [load, live]);

  const day = Number(dueDay);
  const grace = Number(graceDays);
  const valid = /^\d{1,2}$/.test(dueDay) && day >= 1 && day <= 31 && /^\d{1,2}$/.test(graceDays) && grace <= 60;

  const save = async () => {
    if (!valid) {
      setMessage({ kind: "error", text: "Escriba un día del 1 al 31, y los días de gracia (0 si no hay)." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api("POST", "/settings/deadline", { dueDay: day, graceDays: grace });
      setMessage({ kind: "ok", text: "Plazo de pago guardado." });
      await load();
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="stack">
      <h2>Plazo de pago</h2>
      {!today && !message && <p className="muted">Cargando…</p>}
      {today && (
        <div className="card stack" style={{ gap: 8 }}>
          <div className="row">
            <label style={{ flex: 1 }}>
              Día de pago
              <input value={dueDay} onChange={(e) => setDueDay(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" />
            </label>
            <label style={{ flex: 1 }}>
              Días de gracia
              <input value={graceDays} onChange={(e) => setGraceDays(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" />
            </label>
          </div>
          {valid && <div>{deadlineExample(today, { dueDay: day, graceDays: grace })}</div>}
          <div className="muted">
            {saved
              ? `Guardado${saved.savedBy ? ` por ${saved.savedBy}` : ""} el ${formatDate(saved.savedAt)}.`
              : "Mientras no se cambie, cada mes se paga hasta su último día, sin días de gracia."}
          </div>
          {message && <p className={`message ${message.kind}`}>{message.text}</p>}
          <button className="btn primary" disabled={busy} onClick={() => void save()}>
            <Icon name="check" /> Guardar plazo
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * Configuración → Mora (owner, 14 November 2026): the month from which the
 * app adds a late fee by itself to every month not paid in full by its
 * deadline. Earlier months have only the late fees typed in from the paper
 * book (Otro ingreso). Until it is set, the app adds none. Each change is
 * kept and logged.
 */
export function LateFeesSection() {
  const [today, setToday] = useState<string | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [month, setMonth] = useState("");
  const [saved, setSaved] = useState<{ savedAt: string; savedBy: string | null } | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  /** What the field was last filled with: still holding it, it was not changed. */
  const filled = useRef("");

  const newest = useNewest();
  const load = useCallback(
    () =>
      newest(
        api<{ today: string; from: string | null; saved: { savedAt: string; savedBy: string | null } | null }>(
          "GET",
          "/settings/late-fees",
        ),
        (data) => {
          setToday(data.today);
          setFrom(data.from);
          const before = filled.current;
          const now = data.from ? data.from.slice(0, 7) : "";
          filled.current = now;
          setMonth((chosen) => (chosen === before ? now : chosen));
          setSaved(data.saved);
        },
        (err) => setMessage({ kind: "error", text: err.message }),
      ),
    [newest],
  );

  const live = useLive();
  useEffect(() => {
    void load();
  }, [load, live]);

  const save = async () => {
    if (!month) {
      setMessage({ kind: "error", text: "Elija el mes desde el que se cobra la mora." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api("POST", "/settings/late-fees", { month: `${month}-01` });
      setMessage({ kind: "ok", text: "Guardado." });
      await load();
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="stack">
      <h2>Mora</h2>
      {!today && !message && <p className="muted">Cargando…</p>}
      {today && (
        <div className="card stack" style={{ gap: 8 }}>
          <div>
            Desde este mes, cada mes que no se pague completo dentro del plazo de pago debe su mora (el monto de Cuotas → Mora). Los meses
            de antes solo tienen la mora que se anote del cuaderno en Otro ingreso.
          </div>
          <label>
            La mora se cuenta sola desde
            <MonthField value={month} onChange={setMonth} />
          </label>
          <div className="muted">
            {from
              ? `Se cuenta desde ${monthLabel(from.slice(0, 7))}. Guardado${saved?.savedBy ? ` por ${saved.savedBy}` : ""}${saved ? ` el ${formatDate(saved.savedAt)}` : ""}.`
              : "Todavía no se ha puesto: la aplicación no cobra mora por sí misma."}
          </div>
          {message && <p className={`message ${message.kind}`}>{message.text}</p>}
          <button className="btn primary" disabled={busy} onClick={() => void save()}>
            <Icon name="check" /> Guardar mes
          </button>
        </div>
      )}
    </section>
  );
}
