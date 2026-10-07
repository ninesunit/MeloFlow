/** Round to sen (2 decimal places) without floating point drift. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Convert RM to whole sen, the unit used for exact splitting. */
export function toSen(value: number): number {
  return Math.round(value * 100);
}

export function fromSen(sen: number): number {
  return sen / 100;
}

export function formatRM(value: number | null | undefined): string {
  const v = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const sign = v < 0 ? "-" : "";
  return `${sign}RM${Math.abs(v).toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Treat anything below half a sen as zero. */
export function isZero(value: number): boolean {
  return Math.abs(value) < 0.005;
}
