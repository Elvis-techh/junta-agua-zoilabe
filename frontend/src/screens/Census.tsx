import { useEffect, useState, useSyncExternalStore } from "react";

import type { Me } from "../api.ts";
import { api } from "../api.ts";
import type { CensusOptions, HouseholdRow } from "../census.ts";
import { WATER_CONNECTIONS } from "../census.ts";
import type { Go } from "../components/Shell.tsx";
import { Icon } from "../icons.tsx";
import { censusQueue, recall, sendRegistration } from "../queue.ts";

/** Status as word + icon + color together, never color alone. */
export function HouseholdStatus({ status }: { status: "active" | "inactive" }) {
  return status === "active" ? (
    <span className="status ok"><Icon name="check" size={18} /> Activa</span>
  ) : (
    <span className="status danger"><Icon name="x" size={18} /> Inactiva</span>
  );
}

/** Censo: entries still on the phone, then search and the list, filtered by sector and status. */
export function CensusScreen({ me, onOpen, autoFocus }: { me: Me; onOpen: Go; autoFocus: boolean }) {
  const [q, setQ] = useState("");
  const [sectorId, setSectorId] = useState("");
  const [status, setStatus] = useState<"" | "active" | "inactive">("active");
  const [rows, setRows] = useState<HouseholdRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sectors, setSectors] = useState(() => recall<CensusOptions>("options")?.sectors ?? []);

  useEffect(() => {
    api<CensusOptions>("GET", "/census/options")
      .then((options) => setSectors(options.sectors))
      .catch(() => undefined);
  }, []);

  // Typing pauses for a moment before the search goes out, so each letter is not a request.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams();
      if (q.trim()) query.set("q", q.trim());
      if (sectorId) query.set("sectorId", sectorId);
      if (status) query.set("status", status);
      api<{ households: HouseholdRow[] }>("GET", `/census/households?${query}`)
        .then((data) => {
          setRows(data.households);
          setError(null);
        })
        .catch((err: Error) => setError(err.message));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [q, sectorId, status]);

  return (
    <main className="screen wide stack">
      <h1>Censo</h1>

      <PendingEntries me={me} onOpen={onOpen} />

      {me.permissions.includes("census:edit") && (
        <button className="btn primary block" onClick={() => onOpen("/censo/registrar")}>
          <Icon name="house" /> Registrar familia
        </button>
      )}

      <label>
        Buscar
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Nombre, código o referencias"
          autoFocus={autoFocus}
          enterKeyHint="search"
        />
      </label>
      <div className="filters">
        <label>
          Sector
          <select value={sectorId} onChange={(e) => setSectorId(e.target.value)}>
            <option value="">Todos</option>
            {sectors.map((sector) => (
              <option key={sector.id} value={sector.id}>
                {sector.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Estado
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="active">Activas</option>
            <option value="inactive">Inactivas</option>
            <option value="">Todas</option>
          </select>
        </label>
      </div>

      {error && <p className="message error">{error}</p>}
      {!rows && !error && <p className="muted">Cargando…</p>}
      {rows && (
        <p className="muted">
          {rows.length === 1 ? "1 vivienda" : `${rows.length} viviendas`}
        </p>
      )}

      <div className="list household-list">
        {rows?.map((row) => (
          <button key={row.id} className="card household-card" onClick={() => onOpen(`/censo/vivienda/${row.id}`)}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <strong>
                {row.code} · {row.ownerName}
              </strong>
              <HouseholdStatus status={row.status} />
            </div>
            <div className="muted">
              {row.sectorName} · Agua: {WATER_CONNECTIONS[row.waterConnection]}
              {row.paperFormNumber ? ` · Hoja nº ${row.paperFormNumber}` : ""}
            </div>
            <div className="muted clip">{row.references}</div>
          </button>
        ))}
      </div>
    </main>
  );
}

/** "3 registros por enviar", and what to do with any the server did not take. */
function PendingEntries({ me, onOpen }: { me: Me; onOpen: Go }) {
  // The queue's own text, so the list redraws only when the queue changes.
  const snapshot = useSyncExternalStore(
    (listener) => censusQueue.subscribe(listener),
    () => JSON.stringify(censusQueue.entries().filter((entry) => entry.userId === me.id)),
  );
  const entries = JSON.parse(snapshot) as ReturnType<typeof censusQueue.entries>;
  const [sending, setSending] = useState(false);

  if (entries.length === 0) {
    return null;
  }

  const sendNow = async () => {
    setSending(true);
    await censusQueue.sendAll(me.id, sendRegistration);
    setSending(false);
  };

  return (
    <section className="card stack pending">
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <strong>
          <Icon name="upload" size={20} /> {entries.length === 1 ? "1 registro por enviar" : `${entries.length} registros por enviar`}
        </strong>
        <button className="btn" disabled={sending} onClick={() => void sendNow()}>
          {sending ? "Enviando…" : "Enviar ahora"}
        </button>
      </div>
      <p className="muted">Están guardados en este teléfono. Se envían solos cuando hay señal.</p>
      {entries.map((entry) => (
        <div key={entry.submissionId} className="stack" style={{ gap: 8 }}>
          <div>
            <strong>{entry.label.fullName}</strong> · {entry.label.sectorName}
            {entry.registration.paper?.formNumber ? ` · Hoja nº ${entry.registration.paper.formNumber}` : ""}
          </div>
          {entry.state === "attention" && (
            <>
              <p className="message error">{entry.message}</p>
              {entry.existingPerson && (
                <button
                  className="btn go block"
                  onClick={() => {
                    censusQueue.addToExistingPerson(entry.submissionId);
                    void sendNow();
                  }}
                >
                  <Icon name="plus" /> Agregar como otra vivienda de {entry.existingPerson.fullName}
                </button>
              )}
              {!entry.existingPerson && (
                <button
                  className="btn block"
                  onClick={() => {
                    censusQueue.retry(entry.submissionId);
                    void sendNow();
                  }}
                >
                  Intentar de nuevo
                </button>
              )}
              <button
                className="btn danger block"
                onClick={() =>
                  window.confirm(`¿Quitar el registro de ${entry.label.fullName} de este teléfono? No se envió.`) &&
                  censusQueue.discard(entry.submissionId)
                }
              >
                <Icon name="x" /> Quitar de este teléfono
              </button>
            </>
          )}
        </div>
      ))}
      {entries.some((entry) => entry.state === "attention") && (
        <button className="btn block" onClick={() => onOpen("/censo/registrar")}>
          <Icon name="house" /> Registrarla de nuevo, corregida
        </button>
      )}
    </section>
  );
}
