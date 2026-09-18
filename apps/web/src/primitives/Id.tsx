import { truncateMiddle } from "../format";

export interface IdProps {
  value: string;
  /** characters kept after the prefix (brf_, 0x, …) before the ellipsis; four are always kept at the end */
  keep?: number;
  /** truncate prefixed ids (ord_c2e7…88f1); hashes and addresses are always truncated unless `full` */
  short?: boolean;
  /** print the whole value; used where a reader must be able to copy or compare it */
  full?: boolean;
  className?: string;
}

const PREFIX = /^([a-z]{3}_|0x)/;
const PREFIXED = /^(sig|brf|quo|ord|inv)_[0-9a-f]+$/;
const HEX_0X = /^0x[0-9a-fA-F]{16,}$/;
const HEX_BARE = /^[0-9a-f]{32,}$/;
const TAIL = 4;

export function displayId(value: string, short: boolean, keep?: number): string {
  if (keep !== undefined) {
    const prefix = PREFIX.exec(value)?.[0].length ?? 0;
    return truncateMiddle(value, prefix + Math.max(1, keep), TAIL);
  }
  if (HEX_0X.test(value)) return truncateMiddle(value, 6, TAIL);
  if (HEX_BARE.test(value)) return truncateMiddle(value, 8, TAIL);
  if (short && PREFIXED.test(value)) return truncateMiddle(value, 8, TAIL);
  return value;
}

/** The full value is always in the title, whatever is printed. An id keeps its case even inside an uppercase label. */
export function Id({ value, keep, short = false, full = false, className }: IdProps) {
  return (
    <span className={`mono${className ? ` ${className}` : ""}`} title={value} style={{ textTransform: "none", whiteSpace: full ? undefined : "nowrap" }}>
      {full ? value : displayId(value, short, keep)}
    </span>
  );
}
