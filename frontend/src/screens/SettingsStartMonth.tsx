import { useCallback, useEffect, useState } from "react";

import { api } from "../api.ts";
import { MonthField } from "../components/CalendarField.tsx";
import { Dialog } from "../components/Dialog.tsx";
import { Icon } from "../icons.tsx";
import { monthName } from "../payments.ts";
import { formatDate } from "../time.ts";

interface StartMonth {
  month: string;
  savedAt: string;
  savedBy: string | null;
}

/**
 * Configuración → Mes de inicio: the month the app takes over from the paper
 * book, the same for every house (board, 7 November 2026). From it on, every
 * month counts as owed until it is paid; before it, a house owes only the
 * months entered in its file as "Deuda anterior". Saved once, and never
 * changed (owner, 13 November 2026): the confirmation says so before saving.
 */
export function StartMonthSection() {
  const [saved, setSaved] = useState<StartMonth | null>(null);
  const [today, setToday] = useState<string | null>(null);
  const [month, setMonth] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ today: string; startMonth: StartMonth | null }>("GET", "/settings/start-month");
      setSaved(data.startMonth);
      setToday(data.today);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const check = () => {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      setError("Elija el mes de inicio.");
      return;
    }
    setError(null);
    setConfirming(true);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ startMonth: StartMonth }>("POST", "/settings/start-month", { month: `${month}-01` });
      setSaved(data.startMonth);
      setConfirming(false);
    } catch (err) {
      setError((err as Error).message);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="stack">
      <h2>Mes de inicio</h2>
      {!today && !error && <p className="muted">Cargando…</p>}
      {saved ? (
        <div className="card stack" style={{ gap: 8 }}>
          <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
            <strong>Desde {monthName(saved.month)}</strong>
            <span className="status ok">
              <Icon name="lock" size={18} /> Guardado
            </span>
          </div>
          <div>Desde este mes, cada mes cuenta como debido hasta que se pague. Los meses de antes se anotan en cada vivienda, en «Deuda anterior».</div>
          <div className="muted">
            Guardado{saved.savedBy ? ` por ${saved.savedBy}` : ""} el {formatDate(saved.savedAt)}. No se puede cambiar.
          </div>
        </div>
      ) : (
        today && (
          <div className="card stack" style={{ gap: 8 }}>
            <div>
              El mes en que la aplicación toma el lugar del libro de recibos. Desde ese mes, cada mes cuenta como debido hasta que se pague.
            </div>
            <label>
              Mes de inicio
              <MonthField value={month} onChange={setMonth} />
            </label>
            {error && <p className="message error">{error}</p>}
            <button className="btn primary" onClick={check}>
              Seguir
            </button>
          </div>
        )
      )}
      {saved && error && <p className="message error">{error}</p>}

      {confirming && (
        <Dialog title="Mes de inicio" onClose={() => setConfirming(false)}>
          <p>
            La aplicación empieza en <strong>{monthName(`${month}-01`)}</strong>.
          </p>
          <p>Los meses de antes solo se cobran si se anotan como deuda anterior en cada vivienda, copiados del libro de recibos.</p>
          <p className="message error" style={{ margin: 0 }}>
            Una vez guardado, no se puede cambiar.
          </p>
          <div className="row">
            <button className="btn go" disabled={busy} onClick={() => void save()}>
              <Icon name="check" /> Sí, guardar
            </button>
            <button className="btn" disabled={busy} onClick={() => setConfirming(false)}>
              <Icon name="back" /> Volver
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
