import type { InputHTMLAttributes } from "react";
import { useLayoutEffect, useRef } from "react";

import { amountCaret, formatAmountTyping, significantChars } from "../census.ts";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "inputMode" | "type"> & {
  value: string;
  onChange: (value: string) => void;
};

/** "9,999,999.99": the longest amount that fits half a 360 px screen at full size. */
const LONG_AMOUNT_CHARS = 12;

/**
 * An amount in lempiras, with its thousands commas added while it is typed:
 * 1250.5 shows as 1,250.5. `value` is the text as shown; `parseLempiras` reads
 * it. Adding a comma moves the text, so the cursor is put back after the same
 * digit it was after.
 *
 * Half a phone's width holds "9,999,999.99"; a longer amount (up to
 * "999,999,999.99") is drawn a little smaller, so it is seen whole beside the
 * field next to it instead of scrolling inside the box.
 */
export function AmountInput({ value, onChange, style, ...rest }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (caret.current !== null && input.current === document.activeElement) {
      input.current?.setSelectionRange(caret.current, caret.current);
    }
    caret.current = null;
  });

  return (
    <input
      {...rest}
      ref={input}
      style={value.length > LONG_AMOUNT_CHARS ? { ...style, fontSize: "0.88em" } : style}
      inputMode="decimal"
      autoComplete="off"
      value={value}
      onChange={(event) => {
        const typed = event.target.value;
        const before = significantChars(typed.slice(0, event.target.selectionStart ?? typed.length));
        const shown = formatAmountTyping(typed);
        caret.current = amountCaret(shown, before);
        onChange(shown);
      }}
    />
  );
}
