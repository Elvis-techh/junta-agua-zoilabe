import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../api.ts";
import { BackButton } from "../components/BackButton.tsx";
import { DateField } from "../components/CalendarField.tsx";
import { Dialog } from "../components/Dialog.tsx";
import type { Go } from "../components/Shell.tsx";
import type { LogPage } from "../history.ts";
import { withNewest } from "../history.ts";
import { Icon } from "../icons.tsx";
import { useLive, useNewest } from "../live.ts";
import { formatDateTime } from "../time.ts";

const AREAS = [
  { code: "", name: "Todo" },
  { code: "census", name: "Censo" },
  { code: "finances", name: "Finanzas" },
  { code: "users", name: "Usuarios" },
  { code: "settings", name: "Configuración" },
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
export function HistoryScreen({ canHandOut, onOpen }: { canHandOut: boolean; onOpen: Go }) {
  const [area, setArea] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState<LogPage>({ entries: [], nextBefore: null });
  const { entries, nextBefore } = page;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);

  /** The entries the filters ask for, a page at a time. */
  const read = useCallback(
    (before: number | null) => {
      const query = new URLSearchParams();
      if (area) query.set("area", area);
      if (from) query.set("from", from);
      if (to) query.set("to", to);
      if (before) query.set("before", String(before));
      return api<LogPage>("GET", `/audit?${query}`);
    },
    [area, from, to],
  );

  const newest = useNewest();
  /** A first page is on its way, so what is on the screen may still be another filter's. */
  const startingOver = useRef(false);
  const load = useCallback(
    (before: number | null) => {
      setLoading(true);
      setError(null);
      if (!before) startingOver.current = true;
      const settle = () => {
        startingOver.current = false;
        setLoading(false);
      };
      return newest(
        read(before),
        (data) => {
          settle();
          setPage((current) =>
            before ? { entries: [...current.entries, ...data.entries], nextBefore: data.nextBefore } : data,
          );
        },
        (err) => {
          settle();
          setError(err.message);
        },
      );
    },
    [read, newest],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  // After a live change: only what is new, on top. A failure says nothing; the line coming back reads again.
  const live = useLive();
  const seen = useRef(live);
  useEffect(() => {
    if (seen.current === live) return;
    seen.current = live;
    // Nothing to add on top of yet: ask for the first page again, so the older one on its way is dropped.
    if (startingOver.current) {
      void load(null);
      return;
    }
    let current = true;
    read(null)
      .then((latest) => {
        if (!current) return;
        setPage((shown) => withNewest(shown, latest));
        setError(null);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [live, read, load]);

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
      <BackButton onClick={() => onOpen("/")} />
      <h1>Historial</h1>
      {canHandOut && (
        <div className="row">
          <button className="btn" onClick={() => onOpen("/historial/ano")}>
            <Icon name="print" /> Imprimir o guardar un año
          </button>
        </div>
      )}
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
          <DateField value={from} onChange={setFrom} clearable />
        </label>
        <label style={{ flex: "1 1 160px" }}>
          Hasta
          <DateField value={to} onChange={setTo} clearable />
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
