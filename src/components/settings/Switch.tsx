export function Switch({
  checked,
  onChange,
  disabled = false,
  id,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
}) {
  return (
    <label className="set-switch" htmlFor={id}>
      <input
        id={id}
        aria-label={ariaLabel}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
