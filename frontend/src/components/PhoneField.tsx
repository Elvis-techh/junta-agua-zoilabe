import type { PhoneEntry } from "../phone.ts";
import { PHONE_COUNTRIES, phoneHint, typedNumber } from "../phone.ts";

/**
 * The country beside the number, so both fit on a phone's width and neither
 * pushes the button further down. The box shows only "+504"; tapping it opens
 * the phone's own list, with each country's name. It is the real list, see-through
 * and laid over the box, because that is what opens the phone's own picker.
 */
export function PhoneField({
  value,
  onChange,
  ...number
}: {
  value: PhoneEntry;
  onChange: (value: PhoneEntry) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="phone-field">
      <span className="phone-country">
        +{value.code}
        <span aria-hidden="true">▾</span>
        <select
          aria-label="País del teléfono"
          value={value.code}
          onChange={(event) => {
            const code = event.target.value;
            onChange({ code, number: typedNumber(code, value.number) });
          }}
        >
          {PHONE_COUNTRIES.map((country) => (
            <option key={country.code} value={country.code}>
              {country.name} (+{country.code})
            </option>
          ))}
        </select>
      </span>
      <input
        {...number}
        aria-label="Número de teléfono"
        value={value.number}
        onChange={(event) => onChange({ ...value, number: typedNumber(value.code, event.target.value) })}
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder={phoneHint(value.code)}
        autoComplete="off"
      />
    </div>
  );
}
