import { useEffect, useState } from "react";

import type { Me } from "../api.ts";
import { api } from "../api.ts";
import type { CensusOptions, HouseholdRef, PhoneMissing, Registration, Relation, SimilarPerson, WaterConnection } from "../census.ts";
import {
  NO_ID_NUMBER,
  NO_REFERENCES,
  PHONE_MISSING,
  RELATIONS,
  WATER_CONNECTIONS,
  capitalizeName,
  formatIdNumber,
  formatLempiras,
  newSubmissionId,
  parseLempiras,
  whatsappLink,
} from "../census.ts";
import { AmountInput } from "../components/AmountInput.tsx";
import { BackButton } from "../components/BackButton.tsx";
import type { Go } from "../components/Shell.tsx";
import { DateField } from "../components/CalendarField.tsx";
import { PhoneField } from "../components/PhoneField.tsx";
import { Icon } from "../icons.tsx";
import { useLive } from "../live.ts";
import { EMPTY_PHONE, formatPhone, phoneProblem, wholePhone } from "../phone.ts";
import type { QueuedEntry, SentEntry } from "../queue.ts";
import { censusQueue, recall, remember, sendRegistration } from "../queue.ts";
import { formatDate } from "../time.ts";
import { isTouchScreen } from "../viewport.ts";

/** How a registration starts: from scratch, the next paper form, or another house of someone registered. */
export interface RegisterPreset {
  /** Unique per start, so the screen begins clean. */
  startedAt: string;
  paper?: boolean;
  /** "Agregar otra vivienda" from a person's file: who they are, with or without an ID number. */
  existingPerson?: { id: string; fullName: string };
}

type Step =
  | "mode"
  | "paper"
  | "name"
  | "similar"
  | "id"
  | "duplicate"
  | "phone"
  | "gender"
  | "sector"
  | "references"
  | "fee"
  | "relation"
  | "review"
  | "saved";

const ID_MESSAGE = "La identidad debe tener 13 números. Revise, o borre todo para seguir sin ella.";

/**
 * Registrar familia (App Plan, Module 1): one question per screen, a review
 * ("¿Está correcto?") and a saved screen with the household code.
 *
 * Paper entry mode asks first for the date and number on the paper form.
 * The entry is saved on the phone before it is sent, so no signal never
 * loses one.
 *
 * The ID number and the references may be left blank (owner, 19 November
 * 2026): a family may not want to give its ID, and whoever registers may not
 * write easily. The president asks for them later where the board needs them.
 * So that a family is not registered twice without an ID to tell it by, the
 * name is compared with the census as soon as it is typed: look-alikes are
 * shown, and the registrar says whether it is one of them or another family.
 */
export function RegisterScreen({ me, preset, onOpen }: { me: Me; preset: RegisterPreset | null; onOpen: Go }) {
  const [options, setOptions] = useState<CensusOptions | null>(() => recall<CensusOptions>("options"));
  const [optionsError, setOptionsError] = useState<string | null>(null);

  const [submissionId] = useState(newSubmissionId);
  const [mode, setMode] = useState<"house" | "paper" | null>(preset?.paper ? "paper" : null);
  const [step, setStep] = useState<Step>(preset?.paper ? "paper" : "mode");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [paperDate, setPaperDate] = useState("");
  const [paperFormNumber, setPaperFormNumber] = useState("");
  const [fullName, setFullName] = useState(preset?.existingPerson?.fullName ?? "");
  const [idNumber, setIdNumber] = useState("");
  const [phone, setPhone] = useState(EMPTY_PHONE);
  /** Instead of a number: the family has no phone, or prefers not to give it. */
  const [phoneMissing, setPhoneMissing] = useState<PhoneMissing | null>(null);
  const [gender, setGender] = useState("");
  const [sectorId, setSectorId] = useState<number | null>(null);
  const [references, setReferences] = useState("");
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [gpsMessage, setGpsMessage] = useState<string | null>(null);
  const [feeKind, setFeeKind] = useState<"base" | "different" | null>(null);
  const [amountText, setAmountText] = useState("");
  const [feeReason, setFeeReason] = useState("");
  const [relation, setRelation] = useState<Relation | null>(null);
  const [waterConnection, setWaterConnection] = useState<WaterConnection | null>(null);

  /** Set when the ID is already registered: whose it is, and whether this is another house of theirs. */
  const [existing, setExisting] = useState<{ fullName: string; households: HouseholdRef[] } | null>(null);
  const [addToExisting, setAddToExisting] = useState(Boolean(preset?.existingPerson));
  /** Set when this house is added to a person already registered, found by name or from their file. */
  const [existingPersonId, setExistingPersonId] = useState<string | null>(preset?.existingPerson?.id ?? null);
  /** Names that looked alike and the registrar said are other families, and the name they were checked for. */
  const [similar, setSimilar] = useState<SimilarPerson[]>([]);
  const [toldApart, setToldApart] = useState<{ name: string; ids: string[] }>({ name: "", ids: [] });
  const [result, setResult] = useState<{ queued?: QueuedEntry; sent?: SentEntry } | null>(null);

  const live = useLive();
  useEffect(() => {
    api<CensusOptions>("GET", "/census/options")
      .then((loaded) => {
        remember("options", loaded);
        setOptions(loaded);
      })
      .catch((err: Error) => setOptionsError(err.message));
  }, [live]);

  const order: Step[] = [
    ...(mode === "paper" ? (["paper"] as Step[]) : []),
    ...(addToExisting ? [] : (["name", "id", "phone", "gender"] as Step[])),
    "sector",
    "references",
    "fee",
    "relation",
    "review",
  ];

  const move = (direction: 1 | -1) => {
    setError(null);
    const at = order.indexOf(step === "duplicate" || step === "similar" ? "id" : step);
    const next = order[at + direction];
    if (next) {
      setStep(next);
    } else if (direction === -1) {
      setStep("mode");
    }
    window.scrollTo(0, 0);
  };
  const next = () => move(1);
  const back = () => move(-1);

  if (!options) {
    return (
      <main className="screen stack">
        <BackButton onClick={() => onOpen("/")} />
        <h1>Registrar familia</h1>
        <p className={optionsError ? "message error" : "muted"}>
          {optionsError ? "Abra esta pantalla una vez con señal, para que el teléfono guarde la lista de sectores." : "Cargando…"}
        </p>
      </main>
    );
  }

  if (options.sectors.length === 0) {
    return (
      <main className="screen stack">
        <BackButton onClick={() => onOpen("/")} />
        <h1>Registrar familia</h1>
        <p className="message error">Todavía no hay sectores. Pida al administrador que los agregue en Configuración.</p>
      </main>
    );
  }

  const sector = options.sectors.find((s) => s.id === sectorId) ?? null;
  const amountCentavos = parseLempiras(amountText);
  const position = order.indexOf(step === "duplicate" || step === "similar" ? "id" : step);

  /**
   * The name is compared with the census, if there is signal: without it the
   * entry is saved anyway (a name like another is a warning, not a rule).
   */
  const checkName = async () => {
    const name = fullName.trim();
    if (name.length < 3) {
      setError("Escriba el nombre completo.");
      return;
    }
    // Already told apart from these, for this very name: not asked again on the way back.
    if (toldApart.name === name) {
      next();
      return;
    }
    setBusy(true);
    try {
      const { people } = await api<{ people: SimilarPerson[] }>("GET", `/census/people/similar?${new URLSearchParams({ name })}`);
      if (people.length > 0) {
        setSimilar(people);
        setStep("similar");
        window.scrollTo(0, 0);
        return;
      }
    } catch {
      // No signal: the entry goes ahead and is saved on the phone.
    } finally {
      setBusy(false);
    }
    next();
  };

  /** The duplicate check: asked when the ID is typed, if there is signal. With no ID, there is nothing to check. */
  const checkId = async () => {
    if (idNumber === "") {
      next();
      return;
    }
    if (!/^\d{13}$/.test(idNumber)) {
      setError(ID_MESSAGE);
      return;
    }
    setBusy(true);
    try {
      const { person } = await api<{ person: { fullName: string; households: HouseholdRef[] } | null }>(
        "GET",
        `/census/people/lookup?idNumber=${idNumber}`,
      );
      if (person) {
        setExisting(person);
        setStep("duplicate");
        return;
      }
    } catch {
      // No signal: the server checks again when the entry is sent.
    } finally {
      setBusy(false);
    }
    next();
  };

  const locate = () => {
    setGpsMessage("Buscando la ubicación…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGps({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: Math.round(position.coords.accuracy) });
        setGpsMessage(null);
      },
      (err) =>
        setGpsMessage(
          err.code === err.PERMISSION_DENIED
            ? "El teléfono no dio permiso para la ubicación. Puede agregarla después."
            : "No se pudo tomar la ubicación. Intente afuera de la casa, o agréguela después.",
        ),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  };

  const registration = (): Registration => ({
    submissionId,
    ...(mode === "paper" ? { paper: { date: paperDate, ...(paperFormNumber.trim() ? { formNumber: paperFormNumber.trim() } : {}) } } : {}),
    person: existingPersonId
      ? {}
      : addToExisting
        ? { idNumber }
        : {
            fullName: fullName.trim(),
            ...(idNumber ? { idNumber } : {}),
            ...(phoneMissing ? { phoneMissing } : { phone: wholePhone(phone) }),
            ...(gender ? { gender } : {}),
          },
    addToExistingPerson: addToExisting,
    ...(existingPersonId ? { existingPersonId } : {}),
    ...(toldApart.ids.length > 0 && !addToExisting ? { confirmedDifferentFrom: toldApart.ids } : {}),
    household: {
      sectorId: sectorId!,
      ...(references.trim() ? { references: references.trim() } : {}),
      ...(gps ? { gps: { lat: gps.lat, lng: gps.lng } } : {}),
      waterConnection: waterConnection!,
      relation: relation!,
    },
    fee:
      feeKind === "different"
        ? { kind: "different", monthlyAmountCentavos: amountCentavos!, reason: feeReason.trim() }
        : { kind: "base" },
  });

  const save = async () => {
    setBusy(true);
    const body = registration();
    if (!censusQueue.find(submissionId).queued) {
      censusQueue.add({
        submissionId,
        userId: me.id,
        registration: body,
        label: { fullName: capitalizeName(fullName), sectorName: sector?.name ?? "" },
      });
    }
    await censusQueue.sendAll(me.id, sendRegistration);
    setResult(censusQueue.find(submissionId));
    setBusy(false);
    setStep("saved");
  };

  const another = () =>
    onOpen("/censo/registrar", { startedAt: new Date().toISOString(), paper: mode === "paper" });

  // -------------------------------------------------------------------------

  const head = (title: string) => (
    <>
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <button className="btn" onClick={back}>
          <Icon name="back" /> Atrás
        </button>
        {position >= 0 && step !== "review" && (
          <span className="muted">
            Paso {position + 1} de {order.length - 1}
          </span>
        )}
      </div>
      {mode === "paper" && step !== "paper" && (
        <p className="status warn" style={{ justifySelf: "start" }}>
          <Icon name="paper" size={18} /> Hoja de papel{paperFormNumber.trim() ? ` nº ${paperFormNumber.trim()}` : ""}
        </p>
      )}
      <h1>{title}</h1>
    </>
  );

  const errorLine = error && <p className="message error">{error}</p>;

  switch (step) {
    case "mode":
      return (
        <main className="screen stack">
          <BackButton onClick={() => onOpen("/")} />
          <h1>{addToExisting ? `Otra vivienda de ${fullName}` : "Registrar familia"}</h1>
          <p>¿De dónde vienen los datos?</p>
          <button className="btn primary block choice" onClick={() => { setMode("house"); setStep(addToExisting ? "sector" : "name"); }}>
            <Icon name="house" /> Estoy en la vivienda
          </button>
          <button className="btn block choice" onClick={() => { setMode("paper"); setStep("paper"); }}>
            <Icon name="paper" /> Copiar una hoja de papel
          </button>
        </main>
      );

    case "paper":
      return (
        <main className="screen stack">
          {head("Datos de la hoja de papel")}
          <p className="muted">Se guardan junto al registro, para poder compararlo con la hoja.</p>
          <label>
            Fecha escrita en la hoja
            <DateField value={paperDate} max={options.today} onChange={setPaperDate} />
          </label>
          <label>
            Número de la hoja (si tiene)
            <input value={paperFormNumber} onChange={(e) => setPaperFormNumber(e.target.value)} inputMode="numeric" />
          </label>
          {errorLine}
          <button
            className="btn go block"
            onClick={() => (!paperDate ? setError("Escriba la fecha que dice la hoja.") : paperDate > options.today ? setError("La fecha de la hoja no puede ser después de hoy.") : next())}
          >
            Siguiente
          </button>
        </main>
      );

    case "name":
      return (
        <main className="screen stack">
          {head("Nombre completo")}
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus={!isTouchScreen()} autoCapitalize="words" autoComplete="off" />
          {errorLine}
          <button className="btn go block" disabled={busy} onClick={() => void checkName()}>
            Siguiente
          </button>
        </main>
      );

    case "similar":
      return (
        <main className="screen stack">
          {head("Nombre parecido")}
          <p>Ya hay familias con un nombre parecido a {capitalizeName(fullName)}. Si es una de ellas, tóquela para agregarle otra vivienda.</p>
          {similar.map((person) => (
            <button
              key={person.id}
              className="card household-card"
              onClick={() => {
                setAddToExisting(true);
                setExistingPersonId(person.id);
                setFullName(person.fullName);
                setStep("sector");
                window.scrollTo(0, 0);
              }}
            >
              <strong>{person.fullName}</strong>
              {person.households.map((h) => (
                <div key={h.id} className="muted">
                  Vivienda {h.code} · {h.sectorName}
                  {h.status === "inactive" ? " (inactiva)" : ""}
                  {h.references ? ` · ${h.references}` : ""}
                </div>
              ))}
            </button>
          ))}
          <button
            className="btn go block"
            onClick={() => {
              setToldApart({ name: fullName.trim(), ids: similar.map((person) => person.id) });
              setStep("id");
              window.scrollTo(0, 0);
            }}
          >
            No, es otra familia
          </button>
        </main>
      );

    case "id":
      return (
        <main className="screen stack">
          {head("Número de identidad")}
          <input
            value={idNumber}
            onChange={(e) => setIdNumber(e.target.value.replace(/\D/g, "").slice(0, 13))}
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="13 números"
            autoFocus={!isTouchScreen()}
            autoComplete="off"
          />
          <p className="muted">
            {idNumber
              ? `${idNumber.length} de 13 números${idNumber.length === 13 ? ` · ${formatIdNumber(idNumber)}` : ""}`
              : "Si la familia no la quiere dar, déjelo vacío y toque Siguiente."}
          </p>
          {errorLine}
          <button className="btn go block" disabled={busy} onClick={() => void checkId()}>
            Siguiente
          </button>
        </main>
      );

    case "duplicate":
      return (
        <main className="screen stack">
          {head("Esta persona ya está registrada")}
          <div className="card">
            <strong>{existing?.fullName}</strong>
            <div className="muted">Identidad {formatIdNumber(idNumber)}</div>
            {existing?.households.map((h) => (
              <div key={h.id}>
                Vivienda {h.code} · {h.sectorName} {h.status === "inactive" ? "(inactiva)" : ""}
              </div>
            ))}
          </div>
          <p>Una persona puede tener varias viviendas. ¿Es otra vivienda de esta persona?</p>
          <button
            className="btn go block"
            onClick={() => {
              setAddToExisting(true);
              setFullName(existing?.fullName ?? fullName);
              setStep("sector");
            }}
          >
            <Icon name="plus" /> Agregar otra vivienda
          </button>
          {existing?.households[0] && (
            <button className="btn block" onClick={() => onOpen(`/censo/vivienda/${existing.households[0]!.id}`)}>
              <Icon name="house" /> Ver su ficha
            </button>
          )}
          <button className="btn block" onClick={() => setStep("id")}>
            <Icon name="edit" /> Corregir la identidad
          </button>
        </main>
      );

    case "phone":
      return (
        <main className="screen stack">
          {head("Teléfono o WhatsApp")}
          <PhoneField
            value={phone}
            onChange={setPhone}
            // On a phone, not by itself: the keyboard would cover the answers below.
            autoFocus={!isTouchScreen()}
          />
          {errorLine}
          <button
            className="btn go block"
            onClick={() => {
              const problem = phoneProblem(phone);
              if (problem) {
                setError(problem);
                return;
              }
              setPhoneMissing(null);
              next();
            }}
          >
            Siguiente
          </button>
          <p className="muted">Si la familia no tiene teléfono, o no quiere darlo:</p>
          <div className="choice-grid">
            {(Object.keys(PHONE_MISSING) as PhoneMissing[]).map((code) => (
              <button
                key={code}
                className={`btn choice ${phoneMissing === code ? "primary" : ""}`}
                onClick={() => {
                  setPhone({ ...phone, number: "" });
                  setPhoneMissing(code);
                  next();
                }}
              >
                {PHONE_MISSING[code]}
              </button>
            ))}
          </div>
        </main>
      );

    case "gender":
      return (
        <main className="screen stack">
          {head("Género")}
          {options.genders.map((option) => (
            <button
              key={option}
              className={`btn block choice ${gender === option ? "primary" : ""}`}
              onClick={() => {
                setGender(option);
                next();
              }}
            >
              {option}
            </button>
          ))}
          <button className="btn block" onClick={() => { setGender(""); next(); }}>
            Omitir
          </button>
        </main>
      );

    case "sector":
      return (
        <main className="screen stack">
          {head("Sector")}
          {addToExisting && <p className="muted">Otra vivienda de {fullName}.</p>}
          {options.sectors.map((option) => (
            <button
              key={option.id}
              className={`btn block choice ${sectorId === option.id ? "primary" : ""}`}
              onClick={() => {
                setSectorId(option.id);
                next();
              }}
            >
              {option.name}
            </button>
          ))}
        </main>
      );

    case "references":
      return (
        <main className="screen stack">
          {head("Referencias")}
          <label>
            ¿Cómo se encuentra la vivienda? (si no sabe, déjelo vacío)
            <textarea
              value={references}
              onChange={(e) => setReferences(e.target.value)}
              rows={3}
              placeholder="Ejemplo: frente a la iglesia, portón verde"
              autoFocus={!isTouchScreen()}
            />
          </label>
          {mode === "house" &&
            (window.isSecureContext && "geolocation" in navigator ? (
              gps ? (
                <p className="status ok" style={{ justifySelf: "start" }}>
                  <Icon name="pin" size={18} /> Ubicación guardada (±{gps.accuracy} m)
                </p>
              ) : (
                <button className="btn block" onClick={locate}>
                  <Icon name="pin" /> Guardar ubicación (GPS)
                </button>
              )
            ) : (
              <p className="muted">La ubicación GPS se puede agregar cuando la app esté en su dirección segura (https).</p>
            ))}
          {gpsMessage && <p className="muted">{gpsMessage}</p>}
          {errorLine}
          <button className="btn go block" onClick={next}>
            Siguiente
          </button>
        </main>
      );

    case "fee":
      return (
        <main className="screen stack">
          {head("Cuota mensual")}
          <button
            className={`btn block choice ${feeKind === "base" ? "primary" : ""}`}
            onClick={() => {
              setFeeKind("base");
              next();
            }}
          >
            {options.baseFeeCentavos === null
              ? "Precio base"
              : `Precio base: ${formatLempiras(options.baseFeeCentavos)} al mes`}
          </button>
          {options.baseFeeCentavos === null && (
            <p className="muted">La junta todavía no ha fijado el precio base en Configuración.</p>
          )}
          {options.canSetDifferentFee ? (
            <>
              <button className={`btn block choice ${feeKind === "different" ? "primary" : ""}`} onClick={() => setFeeKind("different")}>
                Un monto diferente
              </button>
              {feeKind === "different" && (
                <div className="card stack">
                  <label>
                    Monto al mes, en lempiras
                    <AmountInput value={amountText} onChange={setAmountText} placeholder="Ejemplo: 35" />
                  </label>
                  <label>
                    Razón, en palabras de la junta
                    <textarea value={feeReason} onChange={(e) => setFeeReason(e.target.value)} rows={2} />
                  </label>
                  {errorLine}
                  <button
                    className="btn go block"
                    onClick={() =>
                      amountCentavos === null
                        ? setError("Escriba el monto en lempiras, por ejemplo 35 o 35.50.")
                        : feeReason.trim().length < 3
                          ? setError("Escriba la razón del monto diferente.")
                          : next()
                    }
                  >
                    Siguiente
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="muted">Su cargo no tiene permiso para fijar un monto diferente.</p>
          )}
        </main>
      );

    case "relation":
      return (
        <main className="screen stack">
          {head("Relación y conexión")}
          <h2>¿Qué es de la vivienda?</h2>
          <div className="choice-grid">
            {(Object.keys(RELATIONS) as Relation[]).map((code) => (
              <button key={code} className={`btn choice ${relation === code ? "primary" : ""}`} onClick={() => setRelation(code)}>
                {RELATIONS[code]}
              </button>
            ))}
          </div>
          <h2>Conexión de agua</h2>
          <div className="choice-grid">
            {(Object.keys(WATER_CONNECTIONS) as WaterConnection[]).map((code) => (
              <button
                key={code}
                className={`btn choice ${waterConnection === code ? "primary" : ""}`}
                onClick={() => setWaterConnection(code)}
              >
                {WATER_CONNECTIONS[code]}
              </button>
            ))}
          </div>
          {errorLine}
          <button
            className="btn go block"
            onClick={() =>
              !relation
                ? setError("Elija qué es la persona de la vivienda.")
                : !waterConnection
                  ? setError("Elija el tipo de conexión de agua.")
                  : next()
            }
          >
            Siguiente
          </button>
        </main>
      );

    case "review":
      return (
        <main className="screen stack">
          {head("¿Está correcto?")}
          <div className="card stack" style={{ gap: 6 }}>
            {mode === "paper" && (
              <div>
                Hoja de papel{paperFormNumber.trim() ? ` nº ${paperFormNumber.trim()}` : ""} del {formatDate(`${paperDate}T12:00:00Z`)}
              </div>
            )}
            <strong style={{ fontSize: "1.2rem" }}>{addToExisting ? fullName : capitalizeName(fullName)}</strong>
            {(idNumber || !addToExisting) && <div>Identidad: {idNumber ? formatIdNumber(idNumber) : NO_ID_NUMBER}</div>}
            {addToExisting ? (
              <div className="muted">Otra vivienda de una persona ya registrada</div>
            ) : (
              <>
                <div>Teléfono: {phoneMissing ? PHONE_MISSING[phoneMissing] : formatPhone(wholePhone(phone))}</div>
                {gender && <div>Género: {gender}</div>}
              </>
            )}
            <div>Sector: {sector?.name}</div>
            <div>Referencias: {references.trim() || NO_REFERENCES}</div>
            {gps && <div>Ubicación GPS guardada</div>}
            <div>
              Cuota:{" "}
              {feeKind === "different"
                ? `${formatLempiras(amountCentavos ?? 0)} al mes (${feeReason.trim()})`
                : "precio base"}
            </div>
            <div>
              {RELATIONS[relation!]} · Agua: {WATER_CONNECTIONS[waterConnection!]}
            </div>
          </div>
          <p className="muted">Al guardar, la familia acepta que la Junta de Agua guarde estos datos solo para el servicio de agua.</p>
          <button className="btn go block big" disabled={busy} onClick={() => void save()}>
            <Icon name="check" /> {busy ? "Guardando…" : "Sí, guardar"}
          </button>
          <button className="btn block" onClick={back}>
            <Icon name="edit" /> Corregir
          </button>
        </main>
      );

    case "saved":
      return (
        <main className="screen stack">
          <SavedResult
            result={result}
            onAddToExisting={async () => {
              censusQueue.addToExistingPerson(submissionId);
              setBusy(true);
              await censusQueue.sendAll(me.id, sendRegistration);
              setResult(censusQueue.find(submissionId));
              setBusy(false);
            }}
            onFix={() => {
              censusQueue.discard(submissionId);
              setResult(null);
              setStep("review");
            }}
            onOpen={onOpen}
            busy={busy}
          />
          <button className="btn primary block" onClick={another}>
            <Icon name={mode === "paper" ? "paper" : "plus"} /> {mode === "paper" ? "Registrar otra hoja" : "Registrar otra familia"}
          </button>
          <button className="btn block" onClick={() => onOpen("/")}>
            <Icon name="home" /> Volver al inicio
          </button>
        </main>
      );
  }
}

/** The saved screen's top: the code and WhatsApp, "se enviará cuando haya señal", or what needs a decision. */
function SavedResult({
  result,
  onAddToExisting,
  onFix,
  onOpen,
  busy,
}: {
  result: { queued?: QueuedEntry; sent?: SentEntry } | null;
  onAddToExisting: () => Promise<void>;
  onFix: () => void;
  onOpen: Go;
  busy: boolean;
}) {
  if (result?.sent) {
    const { sent } = result;
    return (
      <>
        <p className="message ok">Guardado.</p>
        <div className="card" style={{ textAlign: "center" }}>
          <div className="muted">Código de la vivienda</div>
          <div className="big-code">{sent.code}</div>
          <div>{sent.fullName}</div>
        </div>
        {sent.phone ? (
          <a className="btn go block" href={whatsappLink(sent.phone, sent.fullName, sent.code)} target="_blank" rel="noreferrer">
            <Icon name="whatsapp" /> Compartir por WhatsApp
          </a>
        ) : (
          <p className="message ok">Esta familia no tiene WhatsApp registrado. Anote el código y entrégueselo.</p>
        )}
        <button className="btn block" onClick={() => onOpen(`/censo/vivienda/${sent.householdId}`)}>
          <Icon name="house" /> Ver la ficha
        </button>
      </>
    );
  }

  const queued = result?.queued;
  if (queued?.state === "attention") {
    return (
      <>
        <p className="message error">{queued.message}</p>
        {queued.existingPerson ? (
          <>
            <p>
              {queued.existingPerson.fullName} ya tiene {queued.existingPerson.codes.join(", ")}. ¿Es otra vivienda de esta persona?
            </p>
            <button className="btn go block" disabled={busy} onClick={() => void onAddToExisting()}>
              <Icon name="plus" /> Agregar como otra vivienda
            </button>
          </>
        ) : null}
        <button className="btn block" onClick={onFix}>
          <Icon name="edit" /> Corregir
        </button>
      </>
    );
  }

  return (
    <>
      <p className="message ok">Guardado. Se enviará cuando haya señal.</p>
      <p className="muted">El código de la vivienda aparece en el Censo cuando se envíe.</p>
    </>
  );
}
