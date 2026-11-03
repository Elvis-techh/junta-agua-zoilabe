import type { InputHTMLAttributes } from "react";
import { useLayoutEffect, useRef } from "react";

import { amountCaret, formatAmountTyping, significantChars } from "../census.ts";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "inputMode" | "type"> & {
  value: string;
  onChange: (value: string) => void;
};

/**
 * An amount in lempiras, with its thousands commas added while it is typed:
 * 1250.5 shows as 1,250.5. `value` is the text as shown; `parseLempiras` reads
 * it. Adding a comma moves the text, so the cursor is put back after the same
 * digit it was after.
 */
export function AmountInput({ value, onChange, ...rest }: Props) {
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
