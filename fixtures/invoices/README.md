# Invoice fixtures

These Markdown files are the canonical source documents for invoice extraction and
reconciliation tests. Convert them to PDF, images, or other transport formats later
without changing the underlying business scenario.

`manifest.json` is the machine-readable expectation map. Expectations describe
facts available in the seeded accounting data; they do not prescribe future agent
policy for approving, rejecting, or escalating an invoice.

| Fixture | Fidelity | Accounting scenario |
| --- | --- | --- |
| `01-acme-po-1001-exact.md` | High | Exact PO and vendor; all ordered quantities received |
| `02-acme-po-1002-partial-receipt.md` | High | Exact PO and vendor; only 8 of 20 units received |
| `03-northstar-po-1003-no-receipt.md` | Medium | Vendor alias; matching open PO with no receipts |
| `04-northstar-po-1004-closed.md` | Medium | Matching PO is closed |
| `05-paper-trail-po-1005-no-contact.md` | High | Matching PO; invoice and seeded vendor lack email contacts |
| `06-acme-po-shared-disambiguated.md` | High | Duplicate PO number resolved by exact vendor identity |
| `07-northstar-po-shared-disambiguated.md` | High | The other duplicate PO resolved to Northstar |
| `07-po-shared-ambiguous-vendor.md` | Low | Duplicate PO number with no usable vendor identity |
| `08-acme-missing-po-number.md` | Medium | Known vendor, but the invoice omits its PO number |
| `09-northstar-unknown-po.md` | High | Known vendor with a PO number absent from accounting |
| `10-unknown-vendor-and-po.md` | High | Both vendor and PO are absent from accounting |
| `11-vendor-po-mismatch.md` | High | PO exists, but belongs to another vendor |
| `12-acme-po-1001-ocr-noisy.md` | Low | Matching invoice represented as noisy OCR text |

The invoices intentionally vary headings, date formats, table columns, aliases,
contact availability, and textual quality. Test code should use the manifest rather
than infer expected outcomes from filenames.

## Generate PDFs and images

The generator uses ReportLab for deterministic letter-sized PDFs and Poppler to
render each PDF page as a PNG. Install `uv` and Poppler, then run:

```bash
pnpm fixtures:generate --clean
```

Outputs are written to:

- `output/pdf/invoices/<fixture>.pdf`
- `output/images/invoices/<fixture>-<page>.png`
- `output/invoice-documents-manifest.json`

Generated artifacts are ignored by Git. The output manifest records source and
artifact hashes, page counts, and paths. Generate one or more fixtures with repeated
`--fixture <manifest-id>` options, or retain only one format with `--format pdf` or
`--format png`.
