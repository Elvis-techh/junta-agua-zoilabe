import { useCallback, useEffect, useState } from "react";

import { ApiError, api } from "../api.ts";
import type { HouseholdFile, HouseholdRow } from "../census.ts";
import type { IncomePreset } from "../collect.ts";
import { formatLempiras, newSubmissionId, parseLempiras } from "../census.ts";
import { BackButton } from "../components/BackButton.tsx";
import { AmountInput } from "../components/AmountInput.tsx";
import { DateField, MonthField } from "../components/CalendarField.tsx";
import { Dialog } from "../components/Dialog.tsx";
import type { Go } from "../components/Shell.tsx";
import { dayLabel } from "../calendar.ts";
import { Icon } from "../icons.tsx";
import type { IncomeEntry, IncomeSetup, IncomeStep, IncomeType } from "../income.ts";
import {
  INCOME_TYPES,
  amountProblem,
  configuredAmount,
  describeIncome,
  incomeSteps,
  incomeTitle,
  needsHouse,
  stepCount,
} from "../income.ts";
import { useLive } from "../live.ts";
import type { PaymentMethod } from "../payments.ts";
import { PAYMENT_METHODS } from "../payments.ts";
import { formatDate } from "../time.ts";
import { isTouchScreen } from "../viewport.ts";
import { HouseholdStatus } from "./Census.tsx";
import { ReceiptDialog } from "./Receipt.tsx";

/** "3 de marzo de 2026" for a calendar date. */
const calendarDate = (date: string) => formatDate(`${date}T12:00:00Z`);

/** The house an entry is for: its code and the name of who it is registered to. */
interface House {
  id: string;
  code: string;
  ownerName: string;
}

type Step = IncomeStep | "saved";

/**
 * Otro ingreso (App Plan, Module 2): a late fee (mora) and its month, a
 * reconnection, a connection fee, a donation or other income. One question
 * per screen, then "¿Está correcto?". Opened from a household's file, the
 * house is already chosen; opened from Cobrar, the house and what is being
 * paid are both chosen (`preset`), and "Atrás" goes back to Cobrar. Opened
 * from Inicio, it asks which house, and a connection fee, a donation or
 * other income may be from someone outside the census. An entry needs
 * signal, like a payment.
 */
export function IncomeScreen({
  householdId,
  preset,
  canReverse,
  canHandOut,
  onOpen,
}: {
  householdId?: string | undefined;
  /** From Cobrar: what is being paid, already answered there. */
  preset?: IncomePreset | undefined;
  canReverse: boolean;
  canHandOut: boolean;
  onOpen: Go;
}) {
  const [setup, setSetup] = useState<IncomeSetup | null>(null);
  const [fixedHouse, setFixedHouse] = useState<House | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [askType, setAskType] = useState(!preset);
  const [step, setStep] = useState<Step>(!preset ? "type" : preset.incomeType === "late_fee" ? "month" : "amount");
  const [type, setType] = useState<IncomeType | null>(preset?.incomeType ?? null);
  const [house, setHouse] = useState<House | null>(null);
  const [month, setMonth] = useState("");
  const [amountText, setAmountText] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [occurredOn, setOccurredOn] = useState("");
  const [amountReason, setAmountReason] = useState("");
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [bankReference, setBankReference] = useState("");
  const [receipt, setReceipt] = useState("");
  const [payerName, setPayerName] = useState("");
  const [note, setNote] = useState("");
  const [submissionId, setSubmissionId] = useState(newSubmissionId);

  const [error, setError] = useState<string | null>(null);
  const [repeated, setRepeated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<IncomeEntry | null>(null);

  const live = useLive();
  useEffect(() => {
    api<IncomeSetup>("GET", "/finance/income/setup")
      .then((loaded) => {
        setSetup(loaded);
        setOccurredOn((day) => day || loaded.today);
      })
      .catch((err: Error) => setLoadError(err.message));
    if (householdId) {
      api<{ household: HouseholdFile }>("GET", `/census/households/${householdId}`)
        .then(({ household }) => {
          const found = { id: household.id, code: household.code, ownerName: household.owner.fullName };
          setFixedHouse(found);
          setHouse(found);
        })
        .catch((err: Error) => setLoadError(err.message));
    }
  }, [householdId, live]);

  // Each time the amount screen opens, it starts from Configuración's amount, until the treasurer types another.
  useEffect(() => {
    if (step !== "amount" || !setup || !type || amountTouched) return;
    const amount = configuredAmount(setup, type, month ? `${month}-01` : "", occurredOn);
    if (amount) {
      setAmountText(formatLempiras(amount).replace(/^L /, "").replace(/\.00$/, ""));
    }
    // Only on arriving at the screen: neither a date changed there nor an amount changed in
    // Configuración meanwhile overwrites what is there. The screen then asks why they differ.
  }, [step, setup !== null]);

  // Back where it was opened from.
  const [leaveTo, leaveLabel] = preset?.fromCollect
    ? (["/finanzas/cobrar", "Cobrar"] as const)
    : householdId
      ? ([`/censo/vivienda/${householdId}`, "Vivienda"] as const)
      : (["/", "Inicio"] as const);
  const leave = () => onOpen(leaveTo);

  if (!setup || (householdId && !fixedHouse)) {
    return (
      <main className="screen stack">
        <BackButton label={leaveLabel} onClick={leave} />
        <p className={loadError ? "message error" : "muted"}>{loadError ?? "Cargando…"}</p>
      </main>
    );
  }

  const order = incomeSteps({ askType, houseChosen: Boolean(fixedHouse), type });
  const position = order.indexOf(step as IncomeStep);
  const counter = stepCount(order, step);
  const what = type ? describeIncome(type, month ? `${month}-01` : null) : "";
  const configured = type ? configuredAmount(setup, type, month ? `${month}-01` : "", occurredOn) : undefined;
  const amountCentavos = parseLempiras(amountText);
  const differs = configured !== undefined && configured !== null && amountCentavos !== null && amountCentavos !== configured;

  const move = (to: Step) => {
    setError(null);
    setStep(to);
    window.scrollTo(0, 0);
  };
  const back = () => (position > 0 ? move(order[position - 1]!) : leave());

  const next = () => move(order[position + 1]!);

  const save = async (confirmRepeatedReceipt = false) => {
    setBusy(true);
    setError(null);
    try {
      const { entry } = await api<{ entry: IncomeEntry }>("POST", "/finance/income", {
        submissionId,
        type,
        ...(house ? { householdId: house.id } : {}),
        ...(type === "late_fee" ? { month: `${month}-01` } : {}),
        amountCentavos,
        occurredOn,
        paymentMethod: method,
        ...(method === "transfer" ? { bankReference: bankReference.trim() } : {}),
        paperReceiptNumber: receipt.trim(),
        ...(payerName.trim() ? { payerName: payerName.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(differs ? { amountReason: amountReason.trim() } : {}),
        ...(confirmRepeatedReceipt ? { confirmRepeatedReceipt: true } : {}),
      });
      setRepeated(null);
      setSaved(entry);
      setStep("saved");
      window.scrollTo(0, 0);
    } catch (err) {
      if (err instanceof ApiError && err.code === "receipt_repeated") {
        setRepeated(err.message);
      } else {
        setRepeated(null);
        setError((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  const startAgain = () => {
    setAskType(true);
    setType(null);
    setHouse(fixedHouse);
    setMonth("");
    setAmountText("");
    setAmountTouched(false);
    setOccurredOn(setup.today);
    setAmountReason("");
    setMethod(null);
    setBankReference("");
    setReceipt("");
    setPayerName("");
    setNote("");
    setSubmissionId(newSubmissionId());
    setSaved(null);
    move("type");
  };

  const head = (title: string) => (
    <>
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <button className="btn" onClick={back}>
          <Icon name="back" /> Atrás
        </button>
        {counter && (
          <span className="muted">
            Paso {counter.at} de {counter.of}
          </span>
        )}
      </div>
      {(house || type) && (
        <p className="muted" style={{ margin: 0 }}>
          {[type && incomeTitle(type, month ? `${month}-01` : null), house && `Vivienda ${house.code} · ${house.ownerName}`]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      <h1>{title}</h1>
    </>
  );
  const errorLine = error && <p className="message error">{error}</p>;

  switch (step) {
    case "type":
      return (
        <main className="screen stack">
          <BackButton label={leaveLabel} onClick={leave} />
          {fixedHouse && (
            <p className="muted" style={{ margin: 0 }}>
              Vivienda {fixedHouse.code} · {fixedHouse.ownerName}
            </p>
          )}
          <h1>¿Qué ingreso es?</h1>
          <div className="choice-grid">
            {(Object.keys(INCOME_TYPES) as IncomeType[]).map((code) => (
              <button
                key={code}
                className={`btn choice ${type === code ? "primary" : ""}`}
                aria-pressed={type === code}
                onClick={() => setType(code)}
              >
                {INCOME_TYPES[code]}
              </button>
            ))}
          </div>
          {errorLine}
          <button className="btn go block" onClick={() => (type ? next() : setError("Elija qué ingreso es."))}>
            Siguiente
          </button>
          {!householdId && <IncomeEntries title="Últimos ingresos" canReverse={canReverse} canHandOut={canHandOut} />}
        </main>
      );

    case "house":
      return (
        <main className="screen stack">
          {head("¿De qué vivienda?")}
          {house && (
            <button className="btn go block" onClick={next}>
              <Icon name="house" /> Seguir con la vivienda {house.code}
            </button>
          )}
          <HouseSearch
            onPick={(row) => {
              setHouse(row);
              setPayerName(row.ownerName);
              // Straight on: the house was the answer. The month screen, or the amount from Configuración.
              next();
            }}
          />
          {type && !needsHouse(type) && (
            <button
              className="btn block"
              onClick={() => {
                setHouse(null);
                setPayerName("");
                next();
              }}
            >
              <Icon name="people" /> No es de una vivienda del censo
            </button>
          )}
          {errorLine}
        </main>
      );

    case "month":
      return (
        <main className="screen stack">
          {head("¿De qué mes es la mora?")}
          <p className="muted" style={{ margin: 0 }}>
            El mes que está anotado en el recibo o en el cuaderno.
          </p>
          <label>
            Mes
            <MonthField value={month} max={occurredOn.slice(0, 7)} onChange={setMonth} />
          </label>
          {month && configured !== undefined && (
            <p style={{ margin: 0 }}>
              {configured === null
                ? `No hay monto de mora para ${what.replace(/^la mora de /, "")} en Configuración.`
                : `La mora de ese mes es de ${formatLempiras(configured)} en Configuración.`}
            </p>
          )}
          {errorLine}
          <button
            className="btn go block"
            onClick={() =>
              !month
                ? setError("Elija el mes de la mora.")
                : month > setup.today.slice(0, 7)
                  ? setError("La mora es de un mes que ya llegó: elija este mes o uno anterior.")
                  : next()
            }
          >
            Siguiente
          </button>
        </main>
      );

    case "amount": {
      const problem = () =>
        amountProblem({ type: type!, amountCentavos, occurredOn, today: setup.today, configured, amountReason, note, what }) ??
        (type === "late_fee" && month > occurredOn.slice(0, 7)
          ? "La mora es de un mes que ya llegó: la fecha del pago no puede ser antes de ese mes."
          : null);
      return (
        <main className="screen stack">
          {head("¿Cuánto pagó?")}
          {configured !== undefined && configured !== null && (
            <p className="muted" style={{ margin: 0 }}>
              {what.charAt(0).toUpperCase() + what.slice(1)} es de {formatLempiras(configured)} en Configuración.
            </p>
          )}
          <div className="row">
            <label style={{ flex: 1 }}>
              Monto, en lempiras
              <AmountInput
                value={amountText}
                onChange={(text) => {
                  setAmountText(text);
                  setAmountTouched(true);
                }}
                placeholder="Ejemplo: 50"
              />
            </label>
            <label style={{ flex: 1 }}>
              Fecha del pago
              <DateField value={occurredOn} max={setup.today} onChange={setOccurredOn} />
            </label>
          </div>
          {differs && (
            <label>
              ¿Por qué es otro monto?
              <input value={amountReason} onChange={(e) => setAmountReason(e.target.value)} placeholder="Ejemplo: el cuaderno dice L 30" />
            </label>
          )}
          {type === "other" && (
            <label>
              ¿De qué es el ingreso?
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ejemplo: venta de tubo sobrante" />
            </label>
          )}
          {errorLine}
          <button
            className="btn go block"
            onClick={() => {
              const found = problem();
              if (found) setError(found);
              else next();
            }}
          >
            Siguiente
          </button>
        </main>
      );
    }

    case "receipt":
      return (
        <main className="screen stack">
          {head("Recibo de papel")}
          <h2 style={{ margin: 0 }}>¿Cómo pagó?</h2>
          <div className="choice-grid">
            {(Object.keys(PAYMENT_METHODS) as PaymentMethod[]).map((code) => (
              <button key={code} className={`btn choice ${method === code ? "primary" : ""}`} onClick={() => setMethod(code)}>
                {PAYMENT_METHODS[code]}
              </button>
            ))}
          </div>
          {method === "transfer" && (
            <label>
              Número de referencia de la transferencia
              <input value={bankReference} onChange={(e) => setBankReference(e.target.value)} autoComplete="off" />
            </label>
          )}
          <label>
            Número del recibo de papel
            <input value={receipt} onChange={(e) => setReceipt(e.target.value)} inputMode="numeric" autoComplete="off" />
          </label>
          {errorLine}
          <button
            className="btn go block"
            onClick={() =>
              !method
                ? setError("Elija cómo se pagó.")
                : method === "transfer" && !bankReference.trim()
                  ? setError("Escriba el número de referencia de la transferencia.")
                  : !receipt.trim()
                    ? setError("Escriba el número del recibo de papel.")
                    : next()
            }
          >
            Siguiente
          </button>
        </main>
      );

    case "payer":
      return (
        <main className="screen stack">
          {head("¿Quién pagó?")}
          <label>
            Nombre de quien pagó
            <input value={payerName} onChange={(e) => setPayerName(e.target.value)} autoCapitalize="words" />
          </label>
          {type !== "other" && (
            <label>
              Nota (opcional)
              <input value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          )}
          {errorLine}
          <button
            className="btn go block"
            onClick={() => (!house && !payerName.trim() ? setError("Escriba el nombre de quien pagó.") : next())}
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
            <strong style={{ fontSize: "1.2rem" }}>
              {incomeTitle(type!, month ? `${month}-01` : null)}: {money(amountCentavos ?? 0)}
            </strong>
            {differs && <div>Otro monto que el de Configuración ({money(configured!)}): {amountReason.trim()}</div>}
            <div>{house ? `Vivienda ${house.code}` : "No es de una vivienda del censo"}</div>
            <div>Fecha: {dayLabel(occurredOn)}</div>
            <div>
              {PAYMENT_METHODS[method!]}
              {method === "transfer" ? `, referencia ${bankReference.trim()}` : ""}
            </div>
            <div>Recibo de papel nº {receipt.trim()}</div>
            <div>Pagó: {payerName.trim() || house?.ownerName}</div>
            {note.trim() && <div>{type === "other" ? "De qué es" : "Nota"}: {note.trim()}</div>}
          </div>
          {errorLine}
          <button className="btn go block big" disabled={busy} onClick={() => void save()}>
            <Icon name="check" /> {busy ? "Guardando…" : "Sí, guardar"}
          </button>
          <button className="btn block" onClick={() => move(order[0]!)}>
            <Icon name="edit" /> Corregir
          </button>
          {repeated && (
            <Dialog title="Número de recibo repetido" onClose={() => setRepeated(null)}>
              <p>{repeated}</p>
              <p>Si el talonario volvió a empezar, guárdelo de todos modos. Quedará marcado para revisarlo.</p>
              <button className="btn go block" disabled={busy} onClick={() => void save(true)}>
                <Icon name="check" /> Sí, guardar con este número
              </button>
              <button
                className="btn block"
                onClick={() => {
                  setRepeated(null);
                  move("receipt");
                }}
              >
                <Icon name="edit" /> Corregir el número
              </button>
            </Dialog>
          )}
        </main>
      );

    case "saved":
      return (
        <main className="screen stack">
          <p className="message ok">
            Guardado. {incomeTitle(saved!.type, saved!.month)} de {formatLempiras(saved!.amountCentavos)} de {saved!.payerName}
            {saved!.householdCode ? `, vivienda ${saved!.householdCode}` : ""}, recibo nº {saved!.paperReceiptNumber}.
          </p>
          {preset?.fromCollect && (
            <button className="btn primary block" onClick={() => onOpen("/finanzas/cobrar")}>
              <Icon name="cash" /> Cobrar a otra vivienda
            </button>
          )}
          <button className={`btn block ${preset?.fromCollect ? "" : "primary"}`} onClick={startAgain}>
            <Icon name="plus" /> Registrar otro ingreso
          </button>
          {saved!.householdId && (
            <button className="btn block" onClick={() => onOpen(`/censo/vivienda/${saved!.householdId}`)}>
              <Icon name="house" /> Ver la vivienda
            </button>
          )}
          <button className="btn block" onClick={() => onOpen(saved!.householdId ? `/finanzas/cobrar/${saved!.householdId}` : "/finanzas/cobrar")}>
            <Icon name="cash" /> Cobrar cuota
          </button>
        </main>
      );
  }
}

/** Which house: the same search as Cobrar's. */
function HouseSearch({ onPick }: { onPick: (house: House) => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<HouseholdRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Typing pauses for a moment before the search goes out, so each letter is not a request.
  const live = useLive();
  useEffect(() => {
    if (!q.trim()) {
      setRows(null);
      return;
    }
    // An answer that arrives after a newer search went out is dropped.
    let current = true;
    const timer = window.setTimeout(() => {
      api<{ households: HouseholdRow[] }>("GET", `/census/households?${new URLSearchParams({ q: q.trim() })}`)
        .then((data) => {
          if (!current) return;
          setRows(data.households);
          setError(null);
        })
        .catch((err: Error) => current && setError(err.message));
    }, 300);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [q, live]);

  return (
    <>
      <label>
        Nombre o código de la vivienda
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Por ejemplo 12"
          autoFocus={!isTouchScreen()}
          enterKeyHint="search"
        />
      </label>
      {error && <p className="message error">{error}</p>}
      {rows?.length === 0 && <p className="muted">No se encontró ninguna vivienda con eso.</p>}
      {rows?.map((row) => (
        <button key={row.id} className="card household-card" onClick={() => onPick({ id: row.id, code: row.code, ownerName: row.ownerName })}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <strong>{row.code}</strong>
            <HouseholdStatus status={row.status} />
          </div>
          <div>{row.ownerName}</div>
          <div className="muted">{row.sectorName}</div>
        </button>
      ))}
    </>
  );
}

/**
 * Other income already recorded, newest first: a house's, in its file, or the
 * latest of everyone's, on Otro ingreso's first screen (where a donation from
 * outside the census can be found). Each can be undone with "Anular".
 * Nothing shows for a house with none.
 */
export function IncomeEntries({ householdId, title, canReverse, canHandOut, phone }: { householdId?: string; title: string; canReverse: boolean; canHandOut?: boolean; phone?: string | null }) {
  const [entries, setEntries] = useState<IncomeEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reversing, setReversing] = useState<IncomeEntry | null>(null);
  const [reversed, setReversed] = useState<IncomeEntry | null>(null);
  const [receiptFor, setReceiptFor] = useState<IncomeEntry | null>(null);

  const load = useCallback(() => {
    api<{ entries: IncomeEntry[] }>("GET", `/finance/income${householdId ? `?householdId=${householdId}` : ""}`)
      .then((data) => {
        setEntries(data.entries);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, [householdId]);

  const live = useLive();
  useEffect(load, [load, live]);

  if (!error && !reversed && (!entries || entries.length === 0)) {
    return null;
  }
  return (
    <section className="stack" style={{ gap: 8 }}>
      <h2>{title}</h2>
      {error && <p className="message error">{error}</p>}
      {reversed && (
        <p className="message ok">
          Anulado: {describeIncome(reversed.type, reversed.month)}, {formatLempiras(reversed.amountCentavos)}, recibo nº{" "}
          {reversed.paperReceiptNumber}.
        </p>
      )}
      {entries?.map((entry) => (
        <IncomeCard
          key={entry.id}
          entry={entry}
          showHouse={!householdId}
          onReverse={canReverse ? () => setReversing(entry) : undefined}
          onReceipt={canHandOut && !entry.reversed ? () => setReceiptFor(entry) : undefined}
        />
      ))}
      {reversing && (
        <ReverseIncomeDialog
          entry={reversing}
          onClose={() => setReversing(null)}
          onReversed={(entry) => {
            setReversing(null);
            setReversed(entry);
            load();
          }}
        />
      )}
      {receiptFor && (
        <ReceiptDialog transactionId={receiptFor.id} phone={phone} canHandOut onClose={() => setReceiptFor(null)} />
      )}
    </section>
  );
}

export function IncomeCard({ entry, showHouse, onReverse, onReceipt }: { entry: IncomeEntry; showHouse: boolean; onReverse?: (() => void) | undefined; onReceipt?: (() => void) | undefined }) {
  return (
    <div className="card stack" style={{ gap: 4 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <strong style={entry.reversed ? { textDecoration: "line-through" } : undefined}>
          {incomeTitle(entry.type, entry.month)}: {money(entry.amountCentavos)}
        </strong>
        <span className="muted">{calendarDate(entry.occurredOn)}</span>
      </div>
      <div>
        Pagó {entry.payerName}
        {showHouse && entry.householdCode ? `, vivienda ${entry.householdCode}` : ""}
      </div>
      <div className="muted">
        Recibo nº {entry.paperReceiptNumber} · {PAYMENT_METHODS[entry.paymentMethod]}
        {entry.bankReference ? ` ${entry.bankReference}` : ""} · Registró {entry.recordedBy}
      </div>
      {entry.amountReason && <div className="muted">Otro monto que el de Configuración: {entry.amountReason}</div>}
      {entry.repeatedReceipt && !entry.reversed && (
        <span className="status warn" style={{ justifySelf: "start" }}>
          <Icon name="alert" size={18} /> Número de recibo repetido: revisar
        </span>
      )}
      {entry.reversal && (
        <>
          <span className="status danger" style={{ justifySelf: "start" }}>
            <Icon name="x" size={18} /> Anulado
          </span>
          <div className="muted">
            Anulado el {calendarDate(entry.reversal.occurredOn)} por {entry.reversal.recordedBy}: {entry.reversal.reason}
          </div>
        </>
      )}
      {entry.note && <div className="muted">{entry.type === "other" ? "De qué es" : "Nota"}: {entry.note}</div>}
      {((onReceipt && !entry.reversed) || (onReverse && !entry.reversed)) && (
        <div className="row">
          {onReceipt && !entry.reversed && (
            <button className="btn" onClick={onReceipt}>
              <Icon name="whatsapp" /> Recibo
            </button>
          )}
          {onReverse && !entry.reversed && (
            <button className="btn" onClick={onReverse}>
              <Icon name="x" /> Anular
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * "Anular": undoes the whole entry with a reversal entry and a written
 * reason, as "Anular pago" does a payment. Nothing is deleted: the entry
 * stays, marked "Anulado", and both are in Historial.
 */
function ReverseIncomeDialog({
  entry,
  onClose,
  onReversed,
}: {
  entry: IncomeEntry;
  onClose: () => void;
  onReversed: (entry: IncomeEntry) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reverse = async () => {
    if (reason.trim().length < 5) {
      setError("Escriba por qué se anula.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { entry: done } = await api<{ entry: IncomeEntry }>("POST", `/finance/income/${entry.id}/reverse`, { reason: reason.trim() });
      onReversed(done);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <Dialog title="Anular este ingreso" onClose={onClose}>
      <p>
        <strong>
          {incomeTitle(entry.type, entry.month)}: {formatLempiras(entry.amountCentavos)}
        </strong>{" "}
        del {calendarDate(entry.occurredOn)}, recibo nº {entry.paperReceiptNumber}.
      </p>
      <p>Se anula completo, con la fecha de hoy. Si estaba mal, después lo puede registrar de nuevo.</p>
      <label>
        Por qué se anula
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ejemplo: se registró en la vivienda equivocada"
          autoFocus={!isTouchScreen()}
        />
      </label>
      <p className="muted">No se borra: queda marcado como anulado, y los dos quedan en el historial.</p>
      {error && <p className="message error">{error}</p>}
      <div className="row">
        <button className="btn primary" disabled={saving} onClick={() => void reverse()}>
          <Icon name="x" /> Anular
        </button>
        <button className="btn" disabled={saving} onClick={onClose}>
          <Icon name="back" /> Volver
        </button>
      </div>
    </Dialog>
  );
}

/** An amount that never breaks between "L" and its number. */
function money(centavos: number) {
  return <span style={{ whiteSpace: "nowrap" }}>{formatLempiras(centavos)}</span>;
}
