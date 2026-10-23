import { useCallback, useEffect, useState } from "react";

import type { LogEntry } from "../api.ts";
import { api } from "../api.ts";
import { Dialog } from "../components/Dialog.tsx";
import { formatDateTime } from "../time.ts";

const AREAS = [
  { code: "", name: "Todo" },
  { code: "census", name: "Censo" },
  { code: "finances", name: "Finanzas" },
  { code: "users", name: "Usuarios" },
  { code: "settings", name: "Configuración" },
  { code: "security", name: "Seguridad" },
  { code: "exports", name: "Impresiones" },
];

interface Detail {
  occurredAt: string;
  summary: string;
  reason: string | null;
  before: unknown;
  after: unknown;
  device: string | null;
}

/**
 * Historial: every entry as a plain sentence, newest first —
 * "12 de marzo, 3:40 p. m.: Ana (Tesorera) registró un pago…".
 */
export function HistoryScreen() {
  const [area, setArea] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);

  const load = useCallback(
    async (before: number | null) => {
      setLoading(true);
      setError(null);
      const query = new URLSearchParams();
      if (area) query.set("area", area);
      if (from) query.set("from", from);
      if (to) query.set("to", to);
      if (before) query.set("before", String(before));
      try {
        const data = await api<{ entries: LogEntry[]; nextBefore: number | null }>("GET", `/audit?${query}`);
        setEntries((current) => (before ? [...current, ...data.entries] : data.entries));
        setNextBefore(data.nextBefore);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [area, from, to],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  const openDetail = async (id: number) => {
    try {
      const { entry } = await api<{ entry: Detail }>("GET", `/audit/${id}`);
      setDetail(entry);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <main className="screen wide stack">
      <h1>Historial</h1>
      <div className="row">
        <label style={{ flex: "1 1 160px" }}>
          Tipo
          <select value={area} onChange={(e) => setArea(e.target.value)}>
            {AREAS.map((a) => (
              <option key={a.code} value={a.code}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ flex: "1 1 160px" }}>
          Desde
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label style={{ flex: "1 1 160px" }}>
          Hasta
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      {error && <p className="message error">{error}</p>}
      {!loading && entries.length === 0 && !error && <p className="muted">No hay nada registrado con estos filtros.</p>}

      <div className="list">
        {entries.map((entry) => (
          <div key={entry.id} className="card">
            <p style={{ margin: 0 }}>
              <strong>{formatDateTime(entry.occurredAt)}:</strong> {entry.summary}
            </p>
            {entry.reason && <p className="muted" style={{ margin: "4px 0 0" }}>Motivo: {entry.reason}</p>}
            {entry.hasDetail && (
              <button className="btn" style={{ marginTop: 10 }} onClick={() => void openDetail(entry.id)}>
                Ver detalle
              </button>
            )}
          </div>
        ))}
      </div>

      {nextBefore && (
        <button className="btn block" disabled={loading} onClick={() => void load(nextBefore)}>
          Ver más
        </button>
      )}

      {detail && (
        <Dialog title="Detalle" onClose={() => setDetail(null)}>
          <p>
            <strong>{formatDateTime(detail.occurredAt)}:</strong> {detail.summary}
          </p>
          {detail.reason && <p>Motivo: {detail.reason}</p>}
          <h2>Antes</h2>
          <pre className="detail">{detail.before === null ? "—" : JSON.stringify(detail.before, null, 2)}</pre>
          <h2>Después</h2>
          <pre className="detail">{detail.after === null ? "—" : JSON.stringify(detail.after, null, 2)}</pre>
          {detail.device && <p className="muted">Dispositivo: {detail.device}</p>}
        </Dialog>
      )}
    </main>
  );
}
