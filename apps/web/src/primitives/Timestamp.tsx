import { clockTime, fullTime } from "../format";

export interface TimestampProps {
  iso: string;
  /** print the date as well as the time */
  full?: boolean;
  className?: string;
}

export function Timestamp({ iso, full = false, className }: TimestampProps) {
  return (
    <time dateTime={iso} title={fullTime(iso)} className={className}>
      {full ? fullTime(iso) : clockTime(iso)}
    </time>
  );
}
