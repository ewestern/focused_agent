const SCALE = 10_000n;

export function parseDecimal(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(value.trim());
  if (!match) throw new Error(`Invalid fixed-point decimal: ${value}`);
  const magnitude =
    BigInt(match[2]) * SCALE + BigInt((match[3] ?? "").padEnd(4, "0"));
  return match[1] === "-" ? -magnitude : magnitude;
}

export function formatDecimal(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const magnitude = value < 0n ? -value : value;
  return `${sign}${magnitude / SCALE}.${String(magnitude % SCALE).padStart(4, "0")}`;
}

export function multiplyDecimal(left: bigint, right: bigint): bigint {
  const product = left * right;
  const adjustment = product < 0n ? -(SCALE / 2n) : SCALE / 2n;
  return (product + adjustment) / SCALE;
}

export function decimalAbsolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}
