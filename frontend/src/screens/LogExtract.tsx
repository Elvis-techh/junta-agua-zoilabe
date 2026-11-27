import { useEffect, useState } from "react";

import { api } from "../api.ts";
import { BackButton } from "../components/BackButton.tsx";
import type { Go } from "../components/Shell.tsx";
import { Icon } from "../icons.tsx";
import { useLive } from "../live.ts";
import type { LogExtract, LogExtractChoices, LogExtractFormat } from "../logExtract.ts";
import { LOG_EXTRACT_COLUMNS, defaultYear, entryCount, logExtractCsv, logExtractFileName, logExtractHeading } from "../logExtract.ts";

/** An extract that was handed out, and how: printed, or saved as a file. */
interface Made {
  extract: LogExtract;
  format: LogExtractFormat;
  fileUrl: string;
}

/**
 * Historial del año (App Plan, Module 4, "Yearly extract"): a year of the
 * history log to print or to save for Excel, for the board's records.
 * Choosing changes nothing; "Imprimir" and "Guardar para Excel" give it a
 * document number, then print it or save the file, as Lista del censo does.
 */
export function LogExtractScreen({ onOpen }: { onOpen: Go }) {
  const [choices, setChoices] = useState<LogExtractChoices | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [made, setMade] = useState<Made | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read again after one is handed out, so the count under the year is current.
  const live = useLive();
  useEffect(() => {
    if (made) return;
    let current = true;
    api<LogExtractChoices>("GET", "/audit/extract")
      .then((data) => {
        if (!current) return;
        setChoices(data);
        setYear((chosen) => chosen ?? defaultYear(data));
      })
      .catch((err: Error) => current && setError(err.message));
    return () => {
      current = false;
    };
  }, [made, live]);

  // The file is let go of when another is made or the screen closes.
  useEffect(() => () => {
    if (made) URL.revokeObjectURL(made.fileUrl);
  }, [made]);

  // Printing waits until the extract is on the page.
  useEffect(() => {
    if (made?.format === "print") {
      window.print();
    }
  }, [made]);

  const handOut = async (format: LogExtractFormat) => {
    if (year === null) return;
    setBusy(true);
    setError(null);
    try {
      const extract = await api<LogExtract>("POST", "/audit/extract", { year, format });
      const file = new Blob([logExtractCsv(extract)], { type: "text/csv;charset=utf-8" });
      const fileUrl = URL.createObjectURL(file);
      if (format === "csv") {
        const link = document.createElement("a");
        link.href = fileUrl;
        link.download = logExtractFileName(extract);
        link.click();
      }
      setMade({ extract, format, fileUrl });
      window.scrollTo(0, 0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (made) {
    const { extract } = made;
    return (
      <main className="screen wide stack">
        <BackButton label="Historial" onClick={() => onOpen("/historial")} />
        <h1>Historial del año</h1>
        <p className="message ok">
          {made.format === "print"
            ? `Historial de ${extract.year}, documento nº ${extract.document.number}, listo para imprimir.`
            : `Historial de ${extract.year}, documento nº ${extract.document.number}, guardado como archivo para Excel.`}
        </p>
        <div className="row">
          {made.format === "print" ? (
            <button className="btn go" onClick={() => window.print()}>
              <Icon name="print" /> Imprimir otra vez
            </button>
          ) : (
            <a className="btn go" href={made.fileUrl} download={logExtractFileName(extract)}>
              <Icon name="down" /> Guardar otra vez
            </a>
          )}
          <button
            className="btn"
            onClick={() => {
              setMade(null);
              window.scrollTo(0, 0);
            }}
          >
            <Icon name="edit" /> Hacer otro
          </button>
        </div>
        <LogExtractDocument extract={extract} />
      </main>
    );
  }

  const chosen = choices?.years.find((choice) => choice.year === year);

  return (
    <main className="screen stack">
      <BackButton label="Historial" onClick={() => onOpen("/historial")} />
      <h1>Historial del año</h1>
      <label>
        Año
        <select value={year ?? ""} disabled={!choices} onChange={(e) => setYear(Number(e.target.value))}>
          {choices?.years.map((choice) => (
            <option key={choice.year} value={choice.year}>
              {choice.year === choices.thisYear ? `${choice.year} (no ha terminado)` : choice.year}
            </option>
          ))}
        </select>
      </label>
      <p className="muted" style={{ margin: 0 }}>
        {chosen ? entryCount(chosen.count) : choices || error ? "" : "Contando…"}
      </p>
      {error && <p className="message error">{error}</p>}
      <div className="row">
        <button className="btn go" disabled={busy || !chosen} onClick={() => void handOut("print")}>
          <Icon name="print" /> {busy ? "Haciendo…" : "Imprimir"}
        </button>
        <button className="btn" disabled={busy || !chosen} onClick={() => void handOut("csv")}>
          <Icon name="down" /> Guardar para Excel
        </button>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Lo de «Ver detalle», con identidades y teléfonos, no sale.
      </p>
    </main>
  );
}

/** The extract as it is printed: the heading lines, then the table, from the same columns as the file. */
export function LogExtractDocument({ extract }: { extract: LogExtract }) {
  const [board, title, ...rest] = logExtractHeading(extract);
  return (
    <section className="print-document print-table">
      <p className="print-board">{board}</p>
      <h2>{title}</h2>
      {rest.map((line, index) => (
        <p key={index} className="muted">
          {line}
        </p>
      ))}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {LOG_EXTRACT_COLUMNS.map((column) => (
                <th key={column.title}>{column.title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {extract.entries.map((entry, index) => (
              <tr key={index}>
                {LOG_EXTRACT_COLUMNS.map((column) => (
                  <td key={column.title} className={column.sentence ? "sentence" : undefined}>
                    {column.value(entry)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
