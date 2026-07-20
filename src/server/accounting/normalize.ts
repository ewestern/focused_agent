export function normalizeName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeEmail(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export function normalizeTaxId(value: string): string {
  return value.replace(/[^\p{L}\p{N}]/gu, "").toLocaleUpperCase("en-US");
}

export function normalizeVendorNumber(value: string): string {
  return value.normalize("NFKC").trim().toLocaleUpperCase("en-US");
}
