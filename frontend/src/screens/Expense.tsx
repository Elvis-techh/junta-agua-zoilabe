import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, api } from "../api.ts";
import { formatLempiras, newSubmissionId, parseLempiras } from "../census.ts";
import { BackButton } from "../components/BackButton.tsx";
import { AmountInput } from "../components/AmountInput.tsx";
import { DateField } from "../components/CalendarField.tsx";
import { Dialog } from "../components/Dialog.tsx";
import type { Go } from "../components/Shell.tsx";
import { dayLabel } from "../calendar.ts";
import type { ExpenseCategory, ExpenseEntry, ExpenseSetup } from "../expenses.ts";
import { amountProblem, paidProblem, photoAddress, photoProblem } from "../expenses.ts";
import { Icon } from "../icons.tsx";
import { useLive } from "../live.ts";
import type { PaymentMethod } from "../payments.ts";
import { PAYMENT_METHODS } from "../payments.ts";
import type { Photo } from "../photo.ts";
import { shrinkPhoto } from "../photo.ts";
import { formatDate } from "../time.ts";
import { isTouchScreen } from "../viewport.ts";

/** "3 de marzo de 2026" for a calendar date. */
const calendarDate = (date: string) => formatDate(`${date}T12:00:00Z`);

type Step = "category" | "amount" | "paid" | "photo" | "review" | "saved";

const ORDER: Step[] = ["category", "amount", "paid", "photo", "review"];

/**
 * Gasto (App Plan, Module 2): what kind of expense, who was paid and how
 * much, how it was paid, and a photo of the receipt or invoice, then "¿Está
 * correcto?". With no paper, "No hay recibo" and why (owner, 15 November
 * 2026). An expense needs signal, like a payment.
 */
export function ExpenseScreen({ canReverse, onOpen }: { canReverse: boolean; onOpen: Go }) {
  const [setup, setSetup] = useState<ExpenseSetup | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("category");
  const [category, setCategory] = useState<ExpenseCategory | null>(null);
  const [supplier, setSupplier] = useState("");
  const [amountText, setAmountText] = useState("");
  const [occurredOn, setOccurredOn] = useState("");
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [bankReference, setBankReference] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [readingPhoto, setReadingPhoto] = useState(false);
  const [noReceipt, setNoReceipt] = useState(false);
  const [noPhotoReason, setNoPhotoReason] = useState("");
  const [submissionId, setSubmissionId] = useState(newSubmissionId);

  const [error, setError] = useState<string | null>(null);
  const [repeated, setRepeated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<ExpenseEntry | null>(null);

  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);

  const live = useLive();
  useEffect(() => {
    api<ExpenseSetup>("GET", "/finance/expenses/setup")
      .then((loaded) => {
        setSetup(loaded);
        setOccurredOn((day) => day || loaded.today);
      })
      .catch((err: Error) => setLoadError(err.message));
  }, [live]);

  const leave = () => onOpen("/");

  if (!setup) {
    return (
      <main className="screen stack">
        <BackButton label="Inicio" onClick={leave} />
        <p className={loadError ? "message error" : "muted"}>{loadError ?? "Cargando…"}</p>
      </main>
    );
  }

  const position = ORDER.indexOf(step);
  const amountCentavos = parseLempiras(amountText);

  const move = (to: Step) => {
    setError(null);
    setStep(to);
    window.scrollTo(0, 0);
  };
  const back = () => (position > 0 ? move(ORDER[position - 1]!) : leave());
  const next = () => move(ORDER[position + 1]!);
  /** On to the next screen, unless this one still has a problem. */
  const nextUnless = (problem: string | null) => (problem ? setError(problem) : next());

  const takePhoto = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    setReadingPhoto(true);
    setError(null);
    try {
      const shrunk = await shrinkPhoto(file);
      setPhoto((old) => {
        if (old) URL.revokeObjectURL(old.previewUrl);
        return shrunk;
      });
      setNoReceipt(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setReadingPhoto(false);
    }
  };

  const save = async (confirmRepeatedInvoice = false) => {
    setBusy(true);
    setError(null);
    try {
      const { entry } = await api<{ entry: ExpenseEntry }>("POST", "/finance/expenses", {
        submissionId,
        categoryId: category!.id,
        supplier: supplier.trim(),
        amountCentavos,
        occurredOn,
        paymentMethod: method,
        ...(method === "transfer" ? { bankReference: bankReference.trim() } : {}),
        ...(invoiceNumber.trim() ? { invoiceNumber: invoiceNumber.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(photo ? { photo: photo.base64 } : { noPhotoReason: noPhotoReason.trim() }),
        ...(confirmRepeatedInvoice ? { confirmRepeatedInvoice: true } : {}),
      });
      setRepeated(null);
      setSaved(entry);
      setStep("saved");
      window.scrollTo(0, 0);
    } catch (err) {
      if (err instanceof ApiError && err.code === "invoice_repeated") {
        setRepeated(err.message);
      } else {
        setRepeated(null);
        // The photo alone can be too much for a very weak signal: say what to do about it.
        setError(err instanceof ApiError && err.status === 413 ? "La foto es demasiado grande. Tómela de nuevo." : (err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  const startAgain = () => {
    setCategory(null);
    setSupplier("");
    setAmountText("");
    setOccurredOn(setup.today);
    setNote("");
    setMethod(null);
    setBankReference("");
    setInvoiceNumber("");
    setPhoto((old) => {
      if (old) URL.revokeObjectURL(old.previewUrl);
      return null;
    });
    setNoReceipt(false);
    setNoPhotoReason("");
    setSubmissionId(newSubmissionId());
    setSaved(null);
    move("category");
  };

  const head = (title: string) => (
    <>
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <button className="btn" onClick={back}>
          <Icon name="back" /> Atrás
        </button>
        {step !== "review" && (
          <span className="muted">
            Paso {position} de {ORDER.length - 2}
          </span>
        )}
      </div>
      {category && (
        <p className="muted" style={{ margin: 0 }}>
          Gasto de {category.name}
        </p>
      )}
      <h1>{title}</h1>
    </>
  );
  const errorLine = error && <p className="message error">{error}</p>;

  switch (step) {
    case "category":
      return (
        <main className="screen stack">
          <BackButton label="Inicio" onClick={leave} />
          <h1>¿Qué gasto es?</h1>
          <div className="choice-grid">
            {setup.categories.map((choice) => (
              <button
                key={choice.id}
                className={`btn choice ${category?.id === choice.id ? "primary" : ""}`}
                aria-pressed={category?.id === choice.id}
                onClick={() => setCategory(choice)}
              >
                {choice.name}
              </button>
            ))}
          </div>
          {errorLine}
          <button className="btn go block" onClick={() => nextUnless(category ? null : "Elija qué gasto es.")}>
            Siguiente
          </button>
          <ExpenseEntries title="Últimos gastos" canReverse={canReverse} />
        </main>
      );

    case "amount":
      return (
        <main className="screen stack">
          {head("¿A quién se le pagó?")}
          <label>
            A quién se le pagó
            <input
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              placeholder="Ejemplo: Ferretería El Puente"
              autoCapitalize="words"
              autoComplete="off"
            />
          </label>
          <div className="row">
            <label style={{ flex: 1 }}>
              Monto, en lempiras
              <AmountInput value={amountText} onChange={setAmountText} placeholder="Ejemplo: 250" />
            </label>
            <label style={{ flex: 1 }}>
              Fecha del gasto
              <DateField value={occurredOn} max={setup.today} onChange={setOccurredOn} />
            </label>
          </div>
          {category!.saysWhat && (
            <label>
              ¿De qué es el gasto?
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ejemplo: papelería para la asamblea" />
            </label>
          )}
          {errorLine}
          <button
            className="btn go block"
            onClick={() =>
              nextUnless(amountProblem({ supplier, amountCentavos, occurredOn, today: setup.today, saysWhat: category!.saysWhat, note }))
            }
          >
            Siguiente
          </button>
        </main>
      );

    case "paid":
      return (
        <main className="screen stack">
          {head("¿Cómo se pagó?")}
          <div className="choice-grid">
            {(Object.keys(PAYMENT_METHODS) as PaymentMethod[]).map((code) => (
              <button
                key={code}
                className={`btn choice ${method === code ? "primary" : ""}`}
                aria-pressed={method === code}
                onClick={() => setMethod(code)}
              >
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
            Número de la factura o recibo (si tiene)
            <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} autoComplete="off" />
          </label>
          {!category!.saysWhat && (
            <label>
              Nota (opcional)
              <input value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          )}
          {errorLine}
          <button className="btn go block" onClick={() => nextUnless(paidProblem({ method, bankReference }))}>
            Siguiente
          </button>
        </main>
      );

    case "photo":
      return (
        <main className="screen stack">
          {head("Foto del recibo")}
          {/* Two doors to the same photo: the camera, or one already on the phone. */}
          <input
            ref={camera}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              void takePhoto(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <input
            ref={gallery}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              void takePhoto(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {photo ? (
            <img className="receipt-photo" src={photo.previewUrl} alt="Foto del recibo o la factura" />
          ) : (
            !noReceipt && (
              <p className="muted" style={{ margin: 0 }}>
                Del recibo o la factura. Que se lean el monto, la fecha y el nombre de la tienda.
              </p>
            )
          )}
          <div className="choice-grid">
            <button className="btn primary" disabled={readingPhoto} onClick={() => camera.current?.click()}>
              <Icon name="camera" /> {readingPhoto ? "Leyendo…" : photo ? "Tomar otra" : "Tomar foto"}
            </button>
            <button className="btn" disabled={readingPhoto} onClick={() => gallery.current?.click()}>
              Elegir foto
            </button>
          </div>
          {!photo && (
            <button
              className={`btn block ${noReceipt ? "primary" : ""}`}
              aria-pressed={noReceipt}
              onClick={() => {
                setNoReceipt(!noReceipt);
                setError(null);
              }}
            >
              <Icon name="x" /> No hay recibo
            </button>
          )}
          {!photo && noReceipt && (
            <label>
              ¿Por qué no hay recibo?
              <input
                value={noPhotoReason}
                onChange={(e) => setNoPhotoReason(e.target.value)}
                placeholder="Ejemplo: jornal pagado a mano"
              />
            </label>
          )}
          {errorLine}
          <button
            className="btn go block"
            disabled={readingPhoto}
            onClick={() => nextUnless(photoProblem({ hasPhoto: photo !== null, noReceipt, noPhotoReason }))}
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
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "nowrap" }}>
              <strong style={{ fontSize: "1.2rem" }}>
                {category!.name}: {money(amountCentavos ?? 0)}
              </strong>
              {photo && <img className="receipt-photo small" src={photo.previewUrl} alt="Foto del recibo o la factura" />}
            </div>
            <div>Se le pagó a: {supplier.trim()}</div>
            <div>Fecha: {dayLabel(occurredOn)}</div>
            <div>
              {PAYMENT_METHODS[method!]}
              {method === "transfer" ? `, referencia ${bankReference.trim()}` : ""}
            </div>
            {invoiceNumber.trim() && <div>Factura o recibo nº {invoiceNumber.trim()}</div>}
            {note.trim() && <div>{category!.saysWhat ? "De qué es" : "Nota"}: {note.trim()}</div>}
            <div>{photo ? "Con la foto del recibo" : `Sin foto: ${noPhotoReason.trim()}`}</div>
          </div>
          {errorLine}
          <button className="btn go block big" disabled={busy} onClick={() => void save()}>
            <Icon name="check" /> {busy ? "Guardando…" : "Sí, guardar"}
          </button>
          <button className="btn block" onClick={() => move("category")}>
            <Icon name="edit" /> Corregir
          </button>
          {repeated && (
            <Dialog title="Número de factura repetido" onClose={() => setRepeated(null)}>
              <p>{repeated}</p>
              <p>Si es otra factura con el mismo número, guárdela de todos modos. Quedará marcada para revisarla.</p>
              <button className="btn go block" disabled={busy} onClick={() => void save(true)}>
                <Icon name="check" /> Sí, guardar con este número
              </button>
              <button
                className="btn block"
                onClick={() => {
                  setRepeated(null);
                  move("paid");
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
            Guardado. Gasto de {saved!.category}: {formatLempiras(saved!.amountCentavos)} a {saved!.supplier}
            {saved!.hasPhoto ? ", con su foto" : ", sin foto"}.
          </p>
          <button className="btn primary block" onClick={startAgain}>
            <Icon name="plus" /> Registrar otro gasto
          </button>
          <button className="btn block" onClick={leave}>
            <Icon name="home" /> Inicio
          </button>
        </main>
      );
  }
}

/**
 * The latest expenses, newest first, on Gasto's first screen. Each can show
 * its photo and be undone with "Anular". Nothing shows while there are none.
 */
export function ExpenseEntries({ title, canReverse }: { title: string; canReverse: boolean }) {
  const [entries, setEntries] = useState<ExpenseEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ExpenseEntry | null>(null);
  const [reversing, setReversing] = useState<ExpenseEntry | null>(null);
  const [reversed, setReversed] = useState<ExpenseEntry | null>(null);

  const load = useCallback(() => {
    api<{ entries: ExpenseEntry[] }>("GET", "/finance/expenses")
      .then((data) => {
        setEntries(data.entries);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

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
          Anulado: el gasto de {reversed.category}, {formatLempiras(reversed.amountCentavos)} a {reversed.supplier}.
        </p>
      )}
      {entries?.map((entry) => (
        <ExpenseCard
          key={entry.id}
          entry={entry}
          onPhoto={() => setViewing(entry)}
          onReverse={canReverse ? () => setReversing(entry) : undefined}
        />
      ))}
      {viewing && (
        <Dialog title="Foto" onClose={() => setViewing(null)}>
          <p style={{ margin: 0 }}>
            {viewing.category}: {formatLempiras(viewing.amountCentavos)} a {viewing.supplier}, {calendarDate(viewing.occurredOn)}.
          </p>
          <img className="receipt-photo" src={photoAddress(viewing.id)} alt="Foto del recibo o la factura" />
        </Dialog>
      )}
      {reversing && (
        <ReverseExpenseDialog
          entry={reversing}
          onClose={() => setReversing(null)}
          onReversed={(entry) => {
            setReversing(null);
            setReversed(entry);
            load();
          }}
        />
      )}
    </section>
  );
}

export function ExpenseCard({
  entry,
  onPhoto,
  onReverse,
}: {
  entry: ExpenseEntry;
  onPhoto?: (() => void) | undefined;
  onReverse?: (() => void) | undefined;
}) {
  return (
    <div className="card stack" style={{ gap: 4 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <strong style={entry.reversed ? { textDecoration: "line-through" } : undefined}>
          {entry.category}: {money(entry.amountCentavos)}
        </strong>
        <span className="muted">{calendarDate(entry.occurredOn)}</span>
      </div>
      <div>Se le pagó a {entry.supplier}</div>
      <div className="muted">
        {entry.invoiceNumber ? `Factura nº ${entry.invoiceNumber} · ` : ""}
        {PAYMENT_METHODS[entry.paymentMethod]}
        {entry.bankReference ? ` ${entry.bankReference}` : ""} · Registró {entry.recordedBy}
      </div>
      {!entry.hasPhoto && (
        <span className="status warn" style={{ justifySelf: "start" }}>
          <Icon name="alert" size={18} /> Sin foto: {entry.noPhotoReason}
        </span>
      )}
      {entry.repeatedInvoice && !entry.reversed && (
        <span className="status warn" style={{ justifySelf: "start" }}>
          <Icon name="alert" size={18} /> Número de factura repetido: revisar
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
      {entry.note && <div className="muted">Nota: {entry.note}</div>}
      {((entry.hasPhoto && onPhoto) || (onReverse && !entry.reversed)) && (
        <div className="row">
          {entry.hasPhoto && onPhoto && (
            <button className="btn" onClick={onPhoto}>
              <Icon name="camera" /> Ver la foto
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
 * "Anular": undoes the whole expense with a reversal entry and a written
 * reason, as "Anular pago" does a payment. Nothing is deleted: the expense
 * and its photo stay, marked "Anulado", and both are in Historial.
 */
function ReverseExpenseDialog({
  entry,
  onClose,
  onReversed,
}: {
  entry: ExpenseEntry;
  onClose: () => void;
  onReversed: (entry: ExpenseEntry) => void;
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
      const { entry: done } = await api<{ entry: ExpenseEntry }>("POST", `/finance/expenses/${entry.id}/reverse`, { reason: reason.trim() });
      onReversed(done);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <Dialog title="Anular este gasto" onClose={onClose}>
      <p>
        <strong>
          {entry.category}: {formatLempiras(entry.amountCentavos)}
        </strong>{" "}
        a {entry.supplier}, del {calendarDate(entry.occurredOn)}.
      </p>
      <p>Se anula completo, con la fecha de hoy. Si estaba mal, después lo puede registrar de nuevo.</p>
      <label>
        Por qué se anula
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ejemplo: se registró dos veces"
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
