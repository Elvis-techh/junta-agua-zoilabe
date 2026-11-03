import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { WEEKDAYS, dayCells, dayLabel, monthCells, monthLabel, placeCalendar, shiftMonth } from "../calendar.ts";
import { Icon } from "../icons.tsx";
import { todayInHonduras } from "../time.ts";

interface FieldProps {
  value: string;
  onChange: (value: string) => void;
  min?: string | undefined;
  max?: string | undefined;
}

/**
 * Month and date fields. A phone keeps its own picker, which is simple and
 * familiar; a computer's is hard to read and in the browser's language, so
 * with a mouse the field opens the app's calendar instead. Both give the same
 * "YYYY-MM" or "YYYY-MM-DD".
 */
function hasMouse(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(hover: hover) and (pointer: fine)").matches === true;
}

/** A month, as "YYYY-MM". */
export function MonthField({ value, onChange, min, max }: FieldProps) {
  const [mouse] = useState(hasMouse);
  if (!mouse) {
    return <input type="month" value={value} min={min} max={max} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <CalendarPopup shown={value ? monthLabel(value) : null} placeholder="Elija el mes" title="Elegir el mes">
      {(close) => <MonthPanel value={value} min={min} max={max} onPick={(picked) => { onChange(picked); close(); }} />}
    </CalendarPopup>
  );
}

/** A day, as "YYYY-MM-DD". `clearable` lets it be left empty again. */
export function DateField({ value, onChange, min, max, clearable = false }: FieldProps & { clearable?: boolean }) {
  const [mouse] = useState(hasMouse);
  if (!mouse) {
    return <input type="date" value={value} min={min} max={max} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <CalendarPopup shown={value ? dayLabel(value) : null} placeholder="Elija la fecha" title="Elegir la fecha">
      {(close) => (
        <DayPanel
          value={value}
          min={min}
          max={max}
          onPick={(picked) => { onChange(picked); close(); }}
          {...(clearable && value ? { onClear: () => { onChange(""); close(); } } : {})}
        />
      )}
    </CalendarPopup>
  );
}

/** The field and its floating panel. In a portal, so a dialog's scrolling cannot cut it off. */
function CalendarPopup({
  shown,
  placeholder,
  title,
  children,
}: {
  shown: string | null;
  placeholder: string;
  title: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [where, setWhere] = useState<{ top: number; left: number } | null>(null);
  const field = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setWhere(null);
    field.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const place = () => {
      if (field.current && panel.current) {
        setWhere(
          placeCalendar(field.current.getBoundingClientRect(), panel.current.getBoundingClientRect(), {
            width: window.innerWidth,
            height: window.innerHeight,
          }),
        );
      }
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // Once it is placed and showing: a hidden panel cannot take the focus.
  const placed = where !== null;
  useEffect(() => {
    if (placed) {
      const start = ['[aria-pressed="true"]', ".current:enabled", ":enabled"]
        .map((which) => panel.current?.querySelector<HTMLButtonElement>(`.calendar-cell${which}`))
        .find(Boolean);
      start?.focus({ preventScroll: true });
    }
  }, [placed]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !field.current?.contains(target)) {
        setOpen(false);
        setWhere(null);
      }
    };
    // Caught first, so Escape closes this panel and not the dialog under it too.
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={field}
        type="button"
        className="date-field"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className={shown ? undefined : "muted"}>{shown ?? placeholder}</span>
        <Icon name="calendar" size={22} />
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            className="calendar"
            role="dialog"
            aria-label={title}
            style={where ?? { visibility: "hidden" }}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </>
  );
}

/** The arrow keys walk the grid; disabled cells are stepped over. */
function walkGrid(event: KeyboardEvent<HTMLDivElement>, columns: number) {
  const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
  const step = steps[event.key];
  if (!step) {
    return;
  }
  event.preventDefault();
  const cells = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(".calendar-cell")];
  let at = cells.indexOf(document.activeElement as HTMLButtonElement) + step;
  while (cells[at]?.disabled) {
    at += step;
  }
  cells[at]?.focus();
}

function CalendarHead({
  label,
  onPrevious,
  onNext,
  previousLabel,
  nextLabel,
}: {
  label: string;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
  previousLabel: string;
  nextLabel: string;
}) {
  return (
    <div className="calendar-head">
      <button type="button" className="calendar-nav" aria-label={previousLabel} disabled={!onPrevious} onClick={onPrevious ?? undefined}>
        <Icon name="back" size={22} />
      </button>
      <strong aria-live="polite">{label}</strong>
      <button type="button" className="calendar-nav" aria-label={nextLabel} disabled={!onNext} onClick={onNext ?? undefined}>
        <Icon name="forward" size={22} />
      </button>
    </div>
  );
}

function MonthPanel({ value, min, max, onPick }: Omit<FieldProps, "onChange"> & { onPick: (month: string) => void }) {
  const today = todayInHonduras().slice(0, 7);
  const [year, setYear] = useState(Number((value || today).slice(0, 4)));
  const thisMonthAllowed = !(min && today < min) && !(max && today > max);

  return (
    <>
      <CalendarHead
        label={String(year)}
        previousLabel="Año anterior"
        nextLabel="Año siguiente"
        onPrevious={min && year <= Number(min.slice(0, 4)) ? null : () => setYear(year - 1)}
        onNext={max && year >= Number(max.slice(0, 4)) ? null : () => setYear(year + 1)}
      />
      <div className="calendar-grid months" onKeyDown={(event) => walkGrid(event, 3)}>
        {monthCells(year, { selected: value, min, max, today }).map((cell) => (
          <button
            key={cell.value}
            type="button"
            className={`calendar-cell${cell.current ? " current" : ""}`}
            aria-pressed={cell.selected}
            disabled={cell.disabled}
            onClick={() => onPick(cell.value)}
          >
            {cell.label}
          </button>
        ))}
      </div>
      {thisMonthAllowed && (
        <div className="calendar-foot">
          <button type="button" className="calendar-link" onClick={() => onPick(today)}>
            Este mes
          </button>
        </div>
      )}
    </>
  );
}

function DayPanel({
  value,
  min,
  max,
  onPick,
  onClear,
}: Omit<FieldProps, "onChange"> & { onPick: (day: string) => void; onClear?: () => void }) {
  const today = todayInHonduras();
  const [month, setMonth] = useState((value || (max && max < today ? max : today)).slice(0, 7));
  const todayAllowed = !(min && today < min) && !(max && today > max);

  return (
    <>
      <CalendarHead
        label={monthLabel(month)}
        previousLabel="Mes anterior"
        nextLabel="Mes siguiente"
        onPrevious={min && month <= min.slice(0, 7) ? null : () => setMonth(shiftMonth(month, -1))}
        onNext={max && month >= max.slice(0, 7) ? null : () => setMonth(shiftMonth(month, 1))}
      />
      <div className="calendar-weekdays" aria-hidden="true">
        {WEEKDAYS.map((day, index) => (
          <span key={index}>{day}</span>
        ))}
      </div>
      <div className="calendar-grid days" onKeyDown={(event) => walkGrid(event, 7)}>
        {dayCells(month, { selected: value, min, max, today }).map((cell, index) =>
          cell ? (
            <button
              key={cell.value}
              type="button"
              className={`calendar-cell${cell.current ? " current" : ""}`}
              aria-pressed={cell.selected}
              aria-label={dayLabel(cell.value)}
              disabled={cell.disabled}
              onClick={() => onPick(cell.value)}
            >
              {cell.label}
            </button>
          ) : (
            <span key={`blank-${index}`} className="calendar-blank" />
          ),
        )}
      </div>
      {(todayAllowed || onClear) && (
        <div className="calendar-foot">
          {todayAllowed ? (
            <button type="button" className="calendar-link" onClick={() => onPick(today)}>
              Hoy
            </button>
          ) : (
            <span />
          )}
          {onClear && (
            <button type="button" className="calendar-link" onClick={onClear}>
              Borrar
            </button>
          )}
        </div>
      )}
    </>
  );
}
