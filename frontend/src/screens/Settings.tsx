import { useCallback, useEffect, useState } from "react";

import { api } from "../api.ts";
import { Icon } from "../icons.tsx";

interface Sector {
  id: number;
  name: string;
  active: boolean;
  households: number;
}

/**
 * Configuración. For now its Sectores part: the list a household's sector is
 * chosen from. Fees, categories and the village profile come with the
 * finance phase.
 */
export function SettingsScreen() {
  const [sectors, setSectors] = useState<Sector[] | null>(null);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setSectors((await api<{ sectors: Sector[] }>("GET", "/settings/sectors")).sectors);
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setMessage(null);
    try {
      await action();
      setMessage({ kind: "ok", text: done });
      await load();
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    }
  };

  return (
    <main className="screen stack">
      <h1>Configuración</h1>
      <h2>Sectores</h2>
      <p className="muted">La lista que aparece al registrar una familia. Un sector no se borra: se quita de la lista.</p>

      <div className="row" style={{ alignItems: "end" }}>
        <label style={{ flex: 1, minWidth: 200 }}>
          Sector nuevo
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ejemplo: El Centro" />
        </label>
        <button
          className="btn primary"
          disabled={name.trim().length < 2}
          onClick={() =>
            void run(async () => {
              await api("POST", "/settings/sectors", { name: name.trim() });
              setName("");
            }, `Sector ${name.trim()} agregado.`)
          }
        >
          <Icon name="plus" /> Agregar
        </button>
      </div>

      {message && <p className={`message ${message.kind}`}>{message.text}</p>}
      {!sectors && !message && <p className="muted">Cargando…</p>}

      <div className="list">
        {sectors?.map((sector) => (
          <div key={sector.id} className="card stack" style={{ gap: 8 }}>
            {renaming?.id === sector.id ? (
              <div className="row" style={{ alignItems: "end" }}>
                <label style={{ flex: 1, minWidth: 200 }}>
                  Nombre
                  <input value={renaming.name} onChange={(e) => setRenaming({ id: sector.id, name: e.target.value })} autoFocus />
                </label>
                <button
                  className="btn go"
                  onClick={() =>
                    void run(async () => {
                      await api("PATCH", `/settings/sectors/${sector.id}`, { name: renaming.name.trim() });
                      setRenaming(null);
                    }, "Nombre cambiado.")
                  }
                >
                  <Icon name="check" /> Guardar
                </button>
              </div>
            ) : (
              <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
                <strong>{sector.name}</strong>
                {sector.active ? (
                  <span className="status ok"><Icon name="check" size={18} /> En la lista</span>
                ) : (
                  <span className="status danger"><Icon name="x" size={18} /> Fuera de la lista</span>
                )}
              </div>
            )}
            <div className="muted">{sector.households === 1 ? "1 vivienda" : `${sector.households} viviendas`}</div>
            <div className="row">
              <button className="btn" onClick={() => setRenaming({ id: sector.id, name: sector.name })}>
                <Icon name="edit" /> Cambiar nombre
              </button>
              <button
                className={`btn ${sector.active ? "danger" : ""}`}
                onClick={() =>
                  void run(
                    () => api("PATCH", `/settings/sectors/${sector.id}`, { active: !sector.active }),
                    sector.active ? `${sector.name} ya no aparece al registrar.` : `${sector.name} vuelve a la lista.`,
                  )
                }
              >
                {sector.active ? "Quitar de la lista" : "Volver a la lista"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
