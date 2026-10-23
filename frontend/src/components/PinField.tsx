/**
 * Six digits on the phone's number keypad, shown as dots. Same feel as the
 * WhatsApp codes the directors already know.
 */
export function PinField({
  value,
  onChange,
  label,
  autoFocus = false,
  isNew = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  autoFocus?: boolean;
  isNew?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        className="pin"
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        autoComplete={isNew ? "new-password" : "current-password"}
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
      />
    </label>
  );
}
