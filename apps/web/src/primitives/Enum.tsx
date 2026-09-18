export interface EnumProps {
  /** a value of a @bullseye/domain enum, printed exactly as the API sent it */
  value: string;
  /** monospaced figure style; without it the value inherits the surrounding label style */
  mono?: boolean;
  className?: string;
}

export function Enum({ value, mono = false, className }: EnumProps) {
  const cls = [mono ? "mono" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <span className={cls || undefined} data-enum={value}>
      {value}
    </span>
  );
}
