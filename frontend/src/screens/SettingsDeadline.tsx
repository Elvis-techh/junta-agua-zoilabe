import { useCallback, useEffect, useState } from "react";

import { api } from "../api.ts";
import { Icon } from "../icons.tsx";
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

  const load = useCallback(async () => {
    try {
      const data = await api<{ today: string; deadline: Deadline; saved: { savedAt: string; savedBy: string | null } | null }>(
        "GET",
        "/settings/deadline",
      );
      setToday(data.today);
      setDueDay(String(data.deadline.dueDay));
      setGraceDays(String(data.deadline.graceDays));
      setSaved(data.saved);
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
