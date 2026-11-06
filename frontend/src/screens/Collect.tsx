import { useEffect, useState } from "react";

import { ApiError, api } from "../api.ts";
import type { HouseholdRow } from "../census.ts";
import { formatLempiras, newSubmissionId, parseLempiras } from "../census.ts";
import { AmountInput } from "../components/AmountInput.tsx";
import { DateField } from "../components/CalendarField.tsx";
import { Dialog } from "../components/Dialog.tsx";
import type { Go } from "../components/Shell.tsx";
import { dayLabel } from "../calendar.ts";
import { Icon } from "../icons.tsx";
import type { HouseMonths, MonthState, Payment, PaymentMethod } from "../payments.ts";
import { PAYMENT_METHODS, choosable, monthName, monthStatus, owedFor, sharePayment, shortMonth, statusLine } from "../payments.ts";
import { isTouchScreen } from "../viewport.ts";
import { HouseholdStatus } from "./Census.tsx";

/** Cobrar, first screen: which house is paying. */
export function CollectScreen({ onOpen }: { onOpen: Go }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<HouseholdRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Typing pauses for a moment before the search goes out, so each letter is not a request.
  useEffect(() => {
    if (!q.trim()) {
      setRows(null);
      return;
    }
    const timer = window.setTimeout(() => {
      api<{ households: HouseholdRow[] }>("GET", `/census/households?${new URLSearchParams({ q: q.trim() })}`)
        .then((data) => {
          setRows(data.households);
          setError(null);
        })
        .catch((err: Error) => setError(err.message));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [q]);

  return (
    <main className="screen stack">
      <h1>Cobrar</h1>
      <label>
        ¿Qué vivienda paga?
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Nombre o código, por ejemplo 12"
          autoFocus={!isTouchScreen()}
          enterKeyHint="search"
        />
      </label>
      {error && <p className="message error">{error}</p>}
      {rows?.length === 0 && <p className="muted">No se encontró ninguna vivienda con eso.</p>}
      {rows?.map((row) => (
        <button key={row.id} className="card household-card" onClick={() => onOpen(`/finanzas/cobrar/${row.id}`)}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <strong>{row.code}</strong>
            <HouseholdStatus status={row.status} />
          </div>
          <div>{row.ownerName}</div>
          <div className="muted">{row.sectorName}</div>
        </button>
      ))}
    </main>
  );
}

type Step = "months" | "amount" | "receipt" | "payer" | "review" | "saved";
const ORDER: Step[] = ["months", "amount", "receipt", "payer", "review"];

/**
 * Cobrar a una vivienda (App Plan, Module 2): the months, the amount and the
 * date, the paper receipt, who paid, then "¿Está correcto?". A payment needs
 * signal: the server shares the money among the months and keeps the paper
 * receipt's number. A retry sends the same submission, so it is never saved twice.
 */
export function PaymentScreen({ id, onOpen }: { id: string; onOpen: Go }) {
  const [data, setData] = useState<HouseMonths | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [from, setFrom] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("months");
  const [selected, setSelected] = useState<string[]>([]);
  const [amountText, setAmountText] = useState("");
  const [occurredOn, setOccurredOn] = useState("");
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [bankReference, setBankReference] = useState("");
  const [receipt, setReceipt] = useState("");
  const [payerName, setPayerName] = useState("");
  const [note, setNote] = useState("");
  const [submissionId, setSubmissionId] = useState(newSubmissionId);

  const [error, setError] = useState<string | null>(null);
  const [repeated, setRepeated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Payment | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const query = from ? `?from=${from}` : "";
    api<HouseMonths>("GET", `/finance/households/${id}/months${query}`)
      .then((loaded) => {
        setData(loaded);
        setOccurredOn((day) => day || loaded.today);
        setPayerName((name) => name || loaded.household.ownerName);
        setLoadError(null);
      })
      .catch((err: Error) => setLoadError(err.message));
  }, [id, from, reload]);

  if (!data) {
    return (
      <main className="screen stack">
        <button className="btn" style={{ justifySelf: "start" }} onClick={() => onOpen("/finanzas/cobrar")}>
          <Icon name="back" /> Cobrar
        </button>
        <p className={loadError ? "message error" : "muted"}>{loadError ?? "Cargando…"}</p>
      </main>
    );
  }

  const { household } = data;
  const states = data.months;
  const chosen = states.filter((state) => selected.includes(state.month));
  const amountCentavos = parseLempiras(amountText);
  const sharing = sharePayment(chosen, amountCentavos);
  const position = ORDER.indexOf(step);

  const move = (to: Step) => {
    setError(null);
    setStep(to);
    window.scrollTo(0, 0);
  };
  const back = () => (position > 0 ? move(ORDER[position - 1]!) : onOpen("/finanzas/cobrar"));

  const toggle = (state: MonthState) =>
    setSelected((list) => (list.includes(state.month) ? list.filter((m) => m !== state.month) : [...list, state.month]));

  const save = async (confirmRepeatedReceipt = false) => {
    setBusy(true);
    setError(null);
    try {
      const { payment } = await api<{ payment: Payment }>("POST", "/finance/payments", {
        submissionId,
        householdId: household.id,
        months: chosen.map((state) => state.month),
        amountCentavos,
        occurredOn,
        paymentMethod: method,
        ...(method === "transfer" ? { bankReference: bankReference.trim() } : {}),
        paperReceiptNumber: receipt.trim(),
        ...(payerName.trim() ? { payerName: payerName.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(confirmRepeatedReceipt ? { confirmRepeatedReceipt: true } : {}),
      });
      setRepeated(null);
      setSaved(payment);
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

  const head = (title: string) => (
    <>
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <button className="btn" onClick={back}>
          <Icon name="back" /> Atrás
        </button>
        {position >= 0 && step !== "review" && (
          <span className="muted">
            Paso {position + 1} de {ORDER.length - 1}
          </span>
        )}
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Vivienda {household.code} · {household.ownerName}
      </p>
      <h1>{title}</h1>
    </>
  );
  const errorLine = error && <p className="message error">{error}</p>;

  switch (step) {
    case "months":
      return (
        <main className="screen stack">
          {head("¿Qué meses paga?")}
          {household.status === "inactive" && <p className="message error">Esta vivienda está inactiva.</p>}
          <button className="btn block" onClick={() => setFrom(addMonths(states[0]!.month, -12))}>
            <Icon name="calendar" /> Ver meses anteriores
          </button>
          <MonthGrid states={states} selected={selected} thisMonth={data.thisMonth} onToggle={toggle} />
          {chosen.length > 0 && (
            <p>
              {chosen.length === 1 ? "Ese mes debe" : `Esos ${chosen.length} meses deben`} <strong>{money(owedFor(chosen))}</strong>.
            </p>
          )}
          {errorLine}
          <button
            className="btn go block"
            onClick={() => {
              if (chosen.length === 0) {
                setError("Elija el mes o los meses que se pagan.");
                return;
              }
              // Start from the full amount: the usual case, and easy to change.
              if (!amountText) setAmountText(formatLempiras(owedFor(chosen)).replace(/^L /, "").replace(/\.00$/, ""));
              move("amount");
            }}
          >
            Siguiente
          </button>
        </main>
      );

    case "amount":
      return (
        <main className="screen stack">
          {head("¿Cuánto pagó?")}
          <p className="muted" style={{ margin: 0 }}>
            {chosen.length === 1 ? "Ese mes debe" : "Esos meses deben"} {formatLempiras(owedFor(chosen))}. Si paga menos, se llenan los meses
            del más viejo al más nuevo.
          </p>
          <div className="row">
            <label style={{ flex: 1 }}>
              Monto, en lempiras
              <AmountInput value={amountText} onChange={setAmountText} placeholder="Ejemplo: 70" />
            </label>
            <label style={{ flex: 1 }}>
              Fecha del pago
              <DateField value={occurredOn} max={data.today} onChange={setOccurredOn} />
            </label>
          </div>
          {errorLine}
          <button
            className="btn go block"
            onClick={() =>
              "problem" in sharing
                ? setError(sharing.problem)
                : !occurredOn
                  ? setError("Elija la fecha del pago.")
                  : occurredOn > data.today
                    ? setError("La fecha del pago no puede ser después de hoy.")
                    : move("receipt")
            }
          >
            Siguiente
          </button>
        </main>
      );

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
                    : move("payer")
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
          <label>
            Nota (opcional)
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {errorLine}
          <button className="btn go block" onClick={() => move("review")}>
            Siguiente
          </button>
        </main>
      );

    case "review":
      return (
        <main className="screen stack">
          {head("¿Está correcto?")}
          <div className="card stack" style={{ gap: 6 }}>
            <strong style={{ fontSize: "1.2rem" }}>{formatLempiras(amountCentavos ?? 0)}</strong>
            {"shares" in sharing &&
              sharing.shares.map((share) => (
                <div key={share.month}>
                  {shortMonth(share.month)} {share.month.slice(0, 4)}: {money(share.amountCentavos)} —{" "}
                  {share.leftCentavos === 0 ? "queda pagado" : <>faltan {money(share.leftCentavos)}</>}
                </div>
              ))}
            <div>Fecha: {dayLabel(occurredOn)}</div>
            <div>
              {PAYMENT_METHODS[method!]}
              {method === "transfer" ? `, referencia ${bankReference.trim()}` : ""}
            </div>
            <div>Recibo de papel nº {receipt.trim()}</div>
            <div>Pagó: {payerName.trim() || household.ownerName}</div>
            {note.trim() && <div>Nota: {note.trim()}</div>}
          </div>
          {errorLine}
          <button className="btn go block big" disabled={busy} onClick={() => void save()}>
            <Icon name="check" /> {busy ? "Guardando…" : "Sí, guardar"}
          </button>
          <button className="btn block" onClick={() => move("months")}>
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
            Guardado. Pago de {formatLempiras(saved!.amountCentavos)} de {saved!.payerName ?? household.ownerName}, vivienda {household.code},
            recibo nº {saved!.paperReceiptNumber}.
          </p>
          <div className="card stack" style={{ gap: 6 }}>
            {"shares" in sharing &&
              sharing.shares.map((share) => (
                <div key={share.month}>
                  {shortMonth(share.month)} {share.month.slice(0, 4)}: {money(share.amountCentavos)} —{" "}
                  {share.leftCentavos === 0 ? "pagado" : <>faltan {money(share.leftCentavos)}</>}
                </div>
              ))}
          </div>
          <button className="btn primary block" onClick={() => onOpen("/finanzas/cobrar")}>
            <Icon name="cash" /> Cobrar otra vivienda
          </button>
          <button className="btn block" onClick={() => onOpen(`/censo/vivienda/${household.id}`)}>
            <Icon name="house" /> Ver la vivienda
          </button>
          <button
            className="btn block"
            onClick={() => {
              // Another payment for the same house starts clean, with the months as they are now.
              setSelected([]);
              setAmountText("");
              setReceipt("");
              setNote("");
              setMethod(null);
              setBankReference("");
              setSubmissionId(newSubmissionId());
              setSaved(null);
              setData(null);
              setReload((count) => count + 1);
              setStep("months");
            }}
          >
            <Icon name="plus" /> Otro pago de esta vivienda
          </button>
        </main>
      );
  }
}

/** An amount that never breaks between "L" and its number. */
function money(centavos: number) {
  return <span style={{ whiteSpace: "nowrap" }}>{formatLempiras(centavos)}</span>;
}

function addMonths(month: string, by: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

/** The months as large buttons, by year: a word and an icon for each one's state, never color alone. */
export function MonthGrid({
  states,
  selected,
  thisMonth,
  onToggle,
}: {
  states: readonly MonthState[];
  selected: readonly string[];
  thisMonth: string;
  onToggle: (state: MonthState) => void;
}) {
  const years = [...new Set(states.map((state) => state.month.slice(0, 4)))];
  return (
    <>
      {years.map((year) => (
        <section key={year} className="stack" style={{ gap: 8 }}>
          <h2 style={{ margin: 0 }}>{year}</h2>
          <div className="choice-grid">
            {states
              .filter((state) => state.month.startsWith(year))
              .map((state) => {
                const on = selected.includes(state.month);
                const kind = monthStatus(state).kind;
                return (
                  <button
                    key={state.month}
                    className={`btn choice month-choice ${on ? "primary" : ""}`}
                    aria-pressed={on}
                    disabled={!choosable(state)}
                    onClick={() => onToggle(state)}
                    aria-label={`${monthName(state.month)}: ${statusLine(state)}`}
                  >
                    <span>
                      {on && <Icon name="check" size={18} />} {shortMonth(state.month)}
                      {state.month === thisMonth ? " (este mes)" : ""}
                    </span>
                    <small>
                      {kind === "paid" && <Icon name="check" size={16} />} {statusLine(state)}
                    </small>
                  </button>
                );
              })}
          </div>
        </section>
      ))}
    </>
  );
}
