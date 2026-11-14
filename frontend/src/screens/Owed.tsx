import { useEffect, useState } from "react";

import { api } from "../api.ts";
import { formatLempiras } from "../census.ts";
import type { Go } from "../components/Shell.tsx";
import { Icon } from "../icons.tsx";
import type { HouseOwed, OwedOption } from "../owed.ts";
import { FIRST_YEAR, lastOwedYear, monthAbbr, optionChoosable, optionLine } from "../owed.ts";
import { monthList, monthName, shortMonth } from "../payments.ts";

type Step = "months" | "mora" | "review" | "saved";
const ORDER: Step[] = ["months", "mora", "review"];

/** An amount that never breaks between "L" and its number. */
function money(centavos: number) {
  return <span style={{ whiteSpace: "nowrap" }}>{formatLempiras(centavos)}</span>;
}

/**
 * Anotar deuda anterior (board, 6 and 7 November 2026): the months a house
 * already owed when the app took over, copied from the paper receipt book.
 * The treasurer taps the unpaid months year by year, as in Cobrar, then
 * marks the ones the book shows with a late fee (mora), then "¿Está
 * correcto?". The server prices each month at the fee in Configuración for
 * it (or the house's different amount) and refuses what cannot be entered.
 * Sending the same months again changes nothing, so a retry is safe.
 */
export function OwedScreen({ id, onOpen }: { id: string; onOpen: Go }) {
  const [house, setHouse] = useState<HouseOwed | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [options, setOptions] = useState<OwedOption[] | null>(null);
  const [step, setStep] = useState<Step>("months");
  // Chosen months across every year looked at, with what each costs.
  const [chosen, setChosen] = useState<Record<string, OwedOption>>({});
  const [mora, setMora] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ created: number; months: string[] } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api<HouseOwed>("GET", `/finance/households/${id}/owed`)
      .then((loaded) => {
        setHouse(loaded);
        setYear((shown) => shown ?? (loaded.startMonth ? lastOwedYear(loaded.startMonth) : null));
        setLoadError(null);
      })
      .catch((err: Error) => setLoadError(err.message));
  }, [id, reload]);

  useEffect(() => {
    if (year === null || !house?.startMonth) return;
    setOptions(null);
    api<{ months: OwedOption[] }>("GET", `/finance/households/${id}/owed/options?year=${year}`)
      .then((loaded) => setOptions(loaded.months))
      .catch((err: Error) => setError(err.message));
  }, [id, year, house?.startMonth, reload]);

  if (!house) {
    return (
      <main className="screen stack">
        <button className="btn" style={{ justifySelf: "start" }} onClick={() => onOpen(`/censo/vivienda/${id}`)}>
          <Icon name="back" /> Vivienda
        </button>
        <p className={loadError ? "message error" : "muted"}>{loadError ?? "Cargando…"}</p>
      </main>
    );
  }

  const start = house.startMonth;
  const months = Object.keys(chosen).sort();
  const feesTotal = months.reduce((sum, month) => sum + chosen[month]!.priceCentavos!, 0);
  const withMora = months.filter((month) => mora[month] && chosen[month]!.lateFeeCentavos !== null);
  const moraTotal = withMora.reduce((sum, month) => sum + chosen[month]!.lateFeeCentavos!, 0);
  const position = ORDER.indexOf(step);

  const move = (to: Step) => {
    setError(null);
    setStep(to);
    window.scrollTo(0, 0);
  };
  const back = () => (position > 0 ? move(ORDER[position - 1]!) : onOpen(`/censo/vivienda/${id}`));

  const toggle = (option: OwedOption) =>
    setChosen((list) => {
      const next = { ...list };
      if (next[option.month]) delete next[option.month];
      else next[option.month] = option;
      return next;
    });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ created: number }>("POST", `/finance/households/${id}/owed`, {
        months: months.map((month) => ({ month, lateFee: withMora.includes(month) })),
      });
      setSaved({ created: result.created, months });
      setStep("saved");
      window.scrollTo(0, 0);
    } catch (err) {
      setError((err as Error).message);
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
        Vivienda {house.household.code} · {house.household.ownerName}
      </p>
      <h1>{title}</h1>
    </>
  );
  const errorLine = error && <p className="message error">{error}</p>;

  if (!start) {
    return (
      <main className="screen stack">
        {head("Deuda anterior")}
        <p className="message error">Todavía no hay mes de inicio. Primero hay que ponerlo en Configuración.</p>
      </main>
    );
  }

  switch (step) {
    case "months":
      return (
        <main className="screen stack">
          {head("¿Qué meses debía?")}
          <p className="muted" style={{ margin: 0 }}>
            Toque los meses que el libro de recibos muestra sin pagar.
          </p>
          <div className="row" style={{ alignItems: "center", justifyContent: "space-between", flexWrap: "nowrap" }}>
            <button className="btn" disabled={year === null || year <= FIRST_YEAR} onClick={() => setYear((y) => y! - 1)}>
              <Icon name="back" /> {year! - 1}
            </button>
            <h2 style={{ margin: 0 }}>{year}</h2>
            <button className="btn" disabled={year === null || year >= lastOwedYear(start)} onClick={() => setYear((y) => y! + 1)}>
              {year! + 1} <Icon name="forward" />
            </button>
          </div>
          {!options ? (
            <p className="muted">Cargando…</p>
          ) : (
            // Three to a row, so a whole year fits in four rows on a phone.
            <div className="choice-grid three">
              {options.map((option) => {
                const on = Boolean(chosen[option.month]);
                return (
                  <button
                    key={option.month}
                    className={`btn choice month-choice ${on ? "primary" : ""}`}
                    aria-pressed={on}
                    disabled={!optionChoosable(option)}
                    onClick={() => toggle(option)}
                    aria-label={`${monthName(option.month)}: ${optionLine(option)}`}
                  >
                    <span>
                      {on && <Icon name="check" size={18} />} {monthAbbr(option.month)}
                    </span>
                    <small>
                      {option.entered && <Icon name="check" size={16} />} {optionLine(option)}
                    </small>
                  </button>
                );
              })}
            </div>
          )}
          {months.length > 0 && (
            <p style={{ margin: 0 }}>
              {months.length === 1 ? "1 mes elegido" : `${months.length} meses elegidos`}: <strong>{money(feesTotal)}</strong>
            </p>
          )}
          {errorLine}
          <button
            className="btn go block"
            onClick={() => (months.length === 0 ? setError("Toque los meses que debía.") : move("mora"))}
          >
            Siguiente
          </button>
        </main>
      );

    case "mora":
      return (
        <main className="screen stack">
          {head("¿Cuáles tienen mora?")}
          <p className="muted" style={{ margin: 0 }}>
            Toque solo los meses que el libro muestra con mora. Se cobra la mora de Configuración para ese mes.
          </p>
          {months.map((month) => {
            const option = chosen[month]!;
            const on = Boolean(mora[month]);
            return (
              <button
                key={month}
                className={`btn block choice ${on && option.lateFeeCentavos !== null ? "primary" : ""}`}
                aria-pressed={on}
                disabled={option.lateFeeCentavos === null}
                onClick={() => setMora((list) => ({ ...list, [month]: !list[month] }))}
              >
                {on && option.lateFeeCentavos !== null && <Icon name="check" size={18} />}
                <span>
                  {`${shortMonth(month)} ${month.slice(0, 4)}: `}
                  {option.lateFeeCentavos === null
                    ? "no hay mora en Configuración"
                    : on
                      ? `con mora de ${formatLempiras(option.lateFeeCentavos)}`
                      : "sin mora"}
                </span>
              </button>
            );
          })}
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
            <strong style={{ fontSize: "1.2rem" }}>{formatLempiras(feesTotal)}</strong>
            {moraTotal > 0 && <div>Más {money(moraTotal)} de mora</div>}
            {months.map((month) => (
              <div key={month}>
                {shortMonth(month)} {month.slice(0, 4)}: {money(chosen[month]!.priceCentavos!)}
                {withMora.includes(month) && <> + mora {money(chosen[month]!.lateFeeCentavos!)}</>}
              </div>
            ))}
          </div>
          {errorLine}
          <button className="btn go block big" disabled={busy} onClick={() => void save()}>
            <Icon name="check" /> {busy ? "Guardando…" : "Sí, guardar"}
          </button>
          <button className="btn block" onClick={() => move("months")}>
            <Icon name="edit" /> Corregir
          </button>
          <p className="muted" style={{ margin: 0 }}>
            Si un mes se anota por error, se puede quitar con un motivo mientras no tenga pagos.
          </p>
        </main>
      );

    case "saved":
      return (
        <main className="screen stack">
          <p className="message ok">
            {saved!.created === 0
              ? "Esos meses ya estaban anotados."
              : `Guardado. Deuda anterior de la vivienda ${house.household.code}: ${monthList(saved!.months)}.`}
          </p>
          <button className="btn primary block" onClick={() => onOpen(`/censo/vivienda/${id}`)}>
            <Icon name="house" /> Ver la vivienda
          </button>
          <button
            className="btn block"
            onClick={() => {
              setChosen({});
              setMora({});
              setSaved(null);
              setReload((count) => count + 1);
              setStep("months");
            }}
          >
            <Icon name="plus" /> Anotar más meses
          </button>
        </main>
      );
  }
}
