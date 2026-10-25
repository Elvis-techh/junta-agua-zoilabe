import { useCallback, useEffect, useState } from "react";

import type { Me } from "../api.ts";
import { api } from "../api.ts";
import type { CensusOptions, HouseholdFile, InactiveReason, PhoneMissing, Relation, WaterConnection } from "../census.ts";
import { INACTIVE_REASONS, PHONE_MISSING, RELATIONS, WATER_CONNECTIONS, formatIdNumber, formatLempiras, whatsappLink } from "../census.ts";
import { Dialog } from "../components/Dialog.tsx";
import type { Go } from "../components/Shell.tsx";
import { Icon } from "../icons.tsx";
import { recall, remember } from "../queue.ts";
import { formatDate, formatDateTime } from "../time.ts";
import { HouseholdStatus } from "./Census.tsx";

/** "3 de marzo de 2026" for a calendar date such as the paper form's. */
const calendarDate = (date: string) => formatDate(`${date}T12:00:00Z`);

/** Ficha de vivienda: everything about one household, and what the user's role may do with it. */
export function HouseholdScreen({ me, id, onOpen }: { me: Me; id: string; onOpen: Go }) {
  const [file, setFile] = useState<HouseholdFile | null>(null);
  const [sensitiveVisible, setSensitiveVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"household" | "person" | "deactivate" | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ household: HouseholdFile; sensitiveVisible: boolean }>("GET", `/census/households/${id}`);
      setFile(data.household);
      setSensitiveVisible(data.sensitiveVisible);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const changed = async (text: string) => {
    setDialog(null);
    setMessage(text);
    await load();
  };

  const can = (permission: string) => me.permissions.includes(permission);

  if (!file) {
    return (
      <main className="screen stack">
        <button className="btn" style={{ justifySelf: "start" }} onClick={() => onOpen("/censo")}>
          <Icon name="back" /> Censo
        </button>
        <p className={error ? "message error" : "muted"}>{error ?? "Cargando…"}</p>
      </main>
    );
  }

  const { owner } = file;

  return (
    <main className="screen stack">
      <button className="btn" style={{ justifySelf: "start" }} onClick={() => onOpen("/censo")}>
        <Icon name="back" /> Censo
      </button>

      <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Vivienda {file.code}</h1>
        <HouseholdStatus status={file.status} />
      </div>
      {file.status === "inactive" && file.inactiveReason && (
        <p className="message error">Inactiva: {INACTIVE_REASONS[file.inactiveReason]}</p>
      )}
      {message && <p className="message ok">{message}</p>}

      <section className="card stack" style={{ gap: 6 }}>
        <strong style={{ fontSize: "1.2rem" }}>{owner.fullName}</strong>
        <div>Identidad: {formatIdNumber(owner.idNumber)}</div>
        <div>Teléfono: {owner.phone ?? (owner.phoneMissing ? PHONE_MISSING[owner.phoneMissing] : "—")}</div>
        {owner.gender && <div>Género: {owner.gender}</div>}
        <div>
          {RELATIONS[owner.relation]} desde el {calendarDate(owner.startsOn)}
        </div>
        {can("census:edit") && (
          <button className="btn block" onClick={() => setDialog("person")}>
            <Icon name="edit" /> Corregir datos de la persona
          </button>
        )}
      </section>

      <section className="card stack" style={{ gap: 6 }}>
        <div>Sector: {file.sector.name}</div>
        <div>Referencias: {file.references}</div>
        <div>Agua: {WATER_CONNECTIONS[file.waterConnection]}</div>
        <div>
          Cuota:{" "}
          {file.fee.kind === "different"
            ? `${formatLempiras(file.fee.monthlyAmountCentavos)} al mes — ${file.fee.reason}`
            : file.fee.baseFeeCentavos === null
              ? "precio base"
              : `precio base (${formatLempiras(file.fee.baseFeeCentavos)} al mes)`}
        </div>
        {file.gps ? (
          <a className="btn block" href={`https://www.google.com/maps?q=${file.gps.lat},${file.gps.lng}`} target="_blank" rel="noreferrer">
            <Icon name="pin" /> Ver en el mapa
          </a>
        ) : (
          <div className="muted">Sin ubicación GPS</div>
        )}
        {can("census:edit") && (
          <button className="btn block" onClick={() => setDialog("household")}>
            <Icon name="edit" /> Corregir datos de la vivienda
          </button>
        )}
      </section>

      <section className="card stack muted" style={{ gap: 4 }}>
        {file.paperDate && (
          <div>
            <Icon name="paper" size={18} /> Hoja de papel{file.paperFormNumber ? ` nº ${file.paperFormNumber}` : ""} del {calendarDate(file.paperDate)}
          </div>
        )}
        <div>
          Registrada por {file.registeredBy} el {formatDateTime(file.createdAt)}
        </div>
        {file.lastVerifiedOn && <div>Verificada el {calendarDate(file.lastVerifiedOn)}</div>}
      </section>

      {file.otherHouseholds.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <h2>Otras viviendas de {owner.fullName}</h2>
          {file.otherHouseholds.map((other) => (
            <button key={other.id} className="card household-card" onClick={() => onOpen(`/censo/vivienda/${other.id}`)}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <strong>{other.code}</strong>
                <HouseholdStatus status={other.status} />
              </div>
              <div className="muted">{other.sectorName}</div>
            </button>
          ))}
        </section>
      )}

      <h2>Acciones</h2>
      {sensitiveVisible && owner.phone && (
        <a className="btn go block" href={whatsappLink(owner.phone, owner.fullName, file.code)} target="_blank" rel="noreferrer">
          <Icon name="whatsapp" /> Compartir por WhatsApp
        </a>
      )}
      {can("census:edit") && sensitiveVisible && (
        <button
          className="btn primary block"
          onClick={() =>
            onOpen("/censo/registrar", {
              startedAt: new Date().toISOString(),
              existingPerson: { idNumber: owner.idNumber, fullName: owner.fullName },
            })
          }
        >
          <Icon name="plus" /> Agregar otra vivienda
        </button>
      )}
      {can("census:deactivate") &&
        (file.status === "active" ? (
          <button className="btn danger block" onClick={() => setDialog("deactivate")}>
            <Icon name="x" /> Desactivar
          </button>
        ) : (
          <button
            className="btn block"
            onClick={() =>
              void api("POST", `/census/households/${file.id}/reactivate`, {})
                .then(() => changed("Vivienda activa de nuevo."))
                .catch((err: Error) => setMessage(err.message))
            }
          >
            <Icon name="check" /> Reactivar
          </button>
        ))}

      {dialog === "household" && <EditHousehold file={file} onClose={() => setDialog(null)} onSaved={changed} />}
      {dialog === "person" && (
        <EditPerson file={file} canEditSensitive={sensitiveVisible} onClose={() => setDialog(null)} onSaved={changed} />
      )}
      {dialog === "deactivate" && <Deactivate file={file} onClose={() => setDialog(null)} onSaved={changed} />}
    </main>
  );
}

function useCensusOptions(): CensusOptions | null {
  const [options, setOptions] = useState(() => recall<CensusOptions>("options"));
  useEffect(() => {
    api<CensusOptions>("GET", "/census/options")
      .then((loaded) => {
        remember("options", loaded);
        setOptions(loaded);
      })
      .catch(() => undefined);
  }, []);
  return options;
}

function EditHousehold({ file, onClose, onSaved }: { file: HouseholdFile; onClose: () => void; onSaved: (text: string) => Promise<void> }) {
  const options = useCensusOptions();
  const [sectorId, setSectorId] = useState(file.sector.id);
  const [references, setReferences] = useState(file.references);
  const [waterConnection, setWaterConnection] = useState<WaterConnection>(file.waterConnection);
  const [relation, setRelation] = useState<Relation>(file.owner.relation);
  const [paperDate, setPaperDate] = useState(file.paperDate ?? "");
  const [paperFormNumber, setPaperFormNumber] = useState(file.paperFormNumber ?? "");
  const [gps, setGps] = useState(file.gps);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The current sector stays choosable even if it was taken off the list since.
  const sectors = options?.sectors.some((s) => s.id === file.sector.id)
    ? options.sectors
    : [file.sector, ...(options?.sectors ?? [])];

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("PATCH", `/census/households/${file.id}`, {
        sectorId,
        references,
        waterConnection,
        relation,
        gps,
        paperDate: paperDate || null,
        paperFormNumber: paperFormNumber.trim() || null,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      await onSaved("Cambios guardados.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const locate = () =>
    navigator.geolocation.getCurrentPosition(
      (position) => setGps({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => setError("No se pudo tomar la ubicación. Intente afuera de la casa."),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );

  return (
    <Dialog title={`Vivienda ${file.code}`} onClose={onClose}>
      <label>
        Sector
        <select value={sectorId} onChange={(e) => setSectorId(Number(e.target.value))}>
          {sectors.map((sector) => (
            <option key={sector.id} value={sector.id}>
              {sector.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Referencias
        <textarea value={references} onChange={(e) => setReferences(e.target.value)} rows={3} />
      </label>
      <label>
        Relación con la vivienda
        <select value={relation} onChange={(e) => setRelation(e.target.value as Relation)}>
          {(Object.keys(RELATIONS) as Relation[]).map((code) => (
            <option key={code} value={code}>
              {RELATIONS[code]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Conexión de agua
        <select value={waterConnection} onChange={(e) => setWaterConnection(e.target.value as WaterConnection)}>
          {(Object.keys(WATER_CONNECTIONS) as WaterConnection[]).map((code) => (
            <option key={code} value={code}>
              {WATER_CONNECTIONS[code]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Fecha de la hoja de papel
        <input type="date" value={paperDate} max={options?.today} onChange={(e) => setPaperDate(e.target.value)} />
      </label>
      <label>
        Número de la hoja
        <input value={paperFormNumber} onChange={(e) => setPaperFormNumber(e.target.value)} />
      </label>
      {window.isSecureContext && "geolocation" in navigator && (
        <div className="row">
          <button className="btn" onClick={locate}>
            <Icon name="pin" /> {gps ? "Tomar la ubicación otra vez aquí" : "Guardar ubicación aquí"}
          </button>
          {gps && (
            <button className="btn danger" onClick={() => setGps(null)}>
              <Icon name="x" /> Quitar ubicación
            </button>
          )}
        </div>
      )}
      <label>
        ¿Por qué se corrige? (opcional)
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {error && <p className="message error">{error}</p>}
      <button className="btn go block" disabled={busy} onClick={() => void save()}>
        <Icon name="check" /> Guardar cambios
      </button>
    </Dialog>
  );
}

function EditPerson({
  file,
  canEditSensitive,
  onClose,
  onSaved,
}: {
  file: HouseholdFile;
  canEditSensitive: boolean;
  onClose: () => void;
  onSaved: (text: string) => Promise<void>;
}) {
  const options = useCensusOptions();
  const { owner } = file;
  const [fullName, setFullName] = useState(owner.fullName);
  const [idNumber, setIdNumber] = useState(owner.idNumber);
  const [phone, setPhone] = useState(owner.phone ?? "");
  const [phoneMode, setPhoneMode] = useState<"number" | PhoneMissing>(owner.phoneMissing ?? "number");
  const [gender, setGender] = useState(owner.gender ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("PATCH", `/census/people/${owner.personId}`, {
        fullName,
        gender: gender || null,
        // ID number and phone are sent only by someone allowed to see them.
        ...(canEditSensitive ? { idNumber, ...(phoneMode === "number" ? { phone } : { phoneMissing: phoneMode }) } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      await onSaved("Datos de la persona guardados.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={owner.fullName} onClose={onClose}>
      <p className="muted">Los cambios valen para todas las viviendas de esta persona.</p>
      <label>
        Nombre completo
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} autoCapitalize="words" />
      </label>
      {canEditSensitive && (
        <>
          <label>
            Número de identidad
            <input value={idNumber} onChange={(e) => setIdNumber(e.target.value.replace(/\D/g, "").slice(0, 13))} inputMode="numeric" />
          </label>
          <label>
            Teléfono o WhatsApp
            <select value={phoneMode} onChange={(e) => setPhoneMode(e.target.value as typeof phoneMode)}>
              <option value="number">Tiene teléfono</option>
              {(Object.keys(PHONE_MISSING) as PhoneMissing[]).map((code) => (
                <option key={code} value={code}>
                  {PHONE_MISSING[code]}
                </option>
              ))}
            </select>
          </label>
          {phoneMode === "number" && (
            <label>
              Número
              <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" placeholder="8 números" />
            </label>
          )}
        </>
      )}
      <label>
        Género
        <select value={gender} onChange={(e) => setGender(e.target.value)}>
          <option value="">Sin indicar</option>
          {(options?.genders ?? []).concat(owner.gender && !options?.genders.includes(owner.gender) ? [owner.gender] : []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label>
        ¿Por qué se corrige? (opcional)
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {error && <p className="message error">{error}</p>}
      <button className="btn go block" disabled={busy} onClick={() => void save()}>
        <Icon name="check" /> Guardar cambios
      </button>
    </Dialog>
  );
}

function Deactivate({ file, onClose, onSaved }: { file: HouseholdFile; onClose: () => void; onSaved: (text: string) => Promise<void> }) {
  const [reason, setReason] = useState<InactiveReason | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/census/households/${file.id}/deactivate`, { reason, ...(note.trim() ? { note: note.trim() } : {}) });
      await onSaved(`Vivienda ${file.code} desactivada. No se borró: se puede reactivar.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={`Desactivar ${file.code}`} onClose={onClose}>
      <p>¿Por qué se desactiva?</p>
      {(Object.keys(INACTIVE_REASONS) as InactiveReason[]).map((code) => (
        <button key={code} className={`btn block choice ${reason === code ? "primary" : ""}`} onClick={() => setReason(code)}>
          {INACTIVE_REASONS[code]}
        </button>
      ))}
      <label>
        Nota (opcional)
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <p className="message error">{error}</p>}
      <button className="btn danger block" disabled={!reason || busy} onClick={() => void save()}>
        <Icon name="x" /> Sí, desactivar
      </button>
    </Dialog>
  );
}
