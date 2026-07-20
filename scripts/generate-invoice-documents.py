#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "reportlab==4.4.3",
# ]
# ///

"""Render canonical Markdown invoice fixtures as deterministic PDFs and PNGs."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import shutil
import struct
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Sequence

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "fixtures" / "invoices"
DEFAULT_PDF_OUTPUT = ROOT / "samples" / "pdf" / "invoices"
DEFAULT_IMAGE_OUTPUT = ROOT / "samples" / "images" / "invoices"
DEFAULT_BUILD_MANIFEST = ROOT / "samples" / "invoice-documents-manifest.json"
TEMP_PDF_OUTPUT = ROOT / "tmp" / "pdfs"

INK = colors.HexColor("#17231F")
MUTED = colors.HexColor("#60706A")
ACCENT = colors.HexColor("#146C52")
ACCENT_LIGHT = colors.HexColor("#E0EDE7")
LINE = colors.HexColor("#D4DBD4")
PAPER = colors.HexColor("#FCFCF8")


@dataclass(frozen=True)
class Fixture:
    fixture_id: str
    source: Path


class DeterministicCanvas(canvas.Canvas):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        kwargs["invariant"] = 1
        super().__init__(*args, **kwargs)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate PDFs and page PNGs from invoice Markdown fixtures."
    )
    parser.add_argument(
        "--format",
        choices=("all", "pdf", "png"),
        default="all",
        help="Artifact type to retain. PNG generation always renders through PDF.",
    )
    parser.add_argument(
        "--fixture",
        action="append",
        default=[],
        metavar="ID",
        help="Generate only this manifest fixture ID. May be repeated.",
    )
    parser.add_argument("--input-dir", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--pdf-dir", type=Path, default=DEFAULT_PDF_OUTPUT)
    parser.add_argument("--image-dir", type=Path, default=DEFAULT_IMAGE_OUTPUT)
    parser.add_argument("--dpi", type=int, default=144)
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Remove prior generated invoice PDFs and PNGs before rendering.",
    )
    args = parser.parse_args()
    if not 72 <= args.dpi <= 300:
        parser.error("--dpi must be between 72 and 300")
    return args


def load_fixtures(input_dir: Path, selected_ids: Sequence[str]) -> list[Fixture]:
    manifest_path = input_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entries = manifest.get("fixtures")
    if manifest.get("version") != 1 or not isinstance(entries, list):
        raise ValueError(f"Unsupported fixture manifest: {manifest_path}")

    fixtures: list[Fixture] = []
    known_ids: set[str] = set()
    known_files: set[str] = set()
    for entry in entries:
        fixture_id = entry.get("id")
        filename = entry.get("file")
        if not isinstance(fixture_id, str) or not isinstance(filename, str):
            raise ValueError("Every manifest fixture needs string id and file values.")
        if fixture_id in known_ids or filename in known_files:
            raise ValueError(f"Duplicate fixture manifest entry: {fixture_id} / {filename}")
        source = input_dir / filename
        if source.suffix != ".md" or not source.is_file():
            raise ValueError(f"Fixture source does not exist: {source}")
        known_ids.add(fixture_id)
        known_files.add(filename)
        fixtures.append(Fixture(fixture_id=fixture_id, source=source))

    actual_files = {
        path.name for path in input_dir.glob("[0-9][0-9]-*.md") if path.is_file()
    }
    if actual_files != known_files:
        missing = sorted(actual_files - known_files)
        stale = sorted(known_files - actual_files)
        raise ValueError(
            f"Manifest/source mismatch. Unmanifested={missing}; missing={stale}"
        )

    if selected_ids:
        unknown = sorted(set(selected_ids) - known_ids)
        if unknown:
            raise ValueError(f"Unknown fixture IDs: {', '.join(unknown)}")
        selected = set(selected_ids)
        fixtures = [fixture for fixture in fixtures if fixture.fixture_id in selected]
    return fixtures


def inline_markup(value: str) -> str:
    escaped = html.escape(value.strip())
    escaped = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", escaped)
    escaped = re.sub(r"`(.+?)`", r"<font name=\"Courier\">\1</font>", escaped)
    return escaped


def styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "body": ParagraphStyle(
            "InvoiceBody",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=12.5,
            textColor=INK,
            spaceAfter=4,
        ),
        "h1": ParagraphStyle(
            "InvoiceH1",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=22,
            leading=26,
            textColor=ACCENT,
            spaceAfter=15,
        ),
        "h2": ParagraphStyle(
            "InvoiceH2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=12.5,
            leading=15,
            textColor=INK,
            spaceBefore=8,
            spaceAfter=6,
        ),
        "quote": ParagraphStyle(
            "InvoiceQuote",
            parent=base["BodyText"],
            fontName="Helvetica-Oblique",
            fontSize=9.5,
            leading=12.5,
            leftIndent=12,
            borderColor=ACCENT,
            borderWidth=1.5,
            borderPadding=(2, 0, 2, 8),
            textColor=MUTED,
            spaceAfter=7,
        ),
        "cell": ParagraphStyle(
            "InvoiceCell",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=8.3,
            leading=10.5,
            textColor=INK,
        ),
        "cell_right": ParagraphStyle(
            "InvoiceCellRight",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=8.3,
            leading=10.5,
            alignment=TA_RIGHT,
            textColor=INK,
        ),
        "cell_header": ParagraphStyle(
            "InvoiceCellHeader",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=8.1,
            leading=10,
            textColor=colors.white,
        ),
    }


def parse_table_row(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def is_alignment_row(cells: Sequence[str]) -> bool:
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells)


def numeric_columns(header: Sequence[str]) -> set[int]:
    numeric_words = {
        "amount",
        "balance",
        "extended",
        "hours",
        "line",
        "po line",
        "price",
        "price per unit",
        "qty",
        "qty shipped",
        "quantity",
        "rate",
        "total",
        "unit",
        "unit price",
        "units",
    }
    return {
        index
        for index, value in enumerate(header)
        if re.sub(r"[*`]", "", value).strip().lower() in numeric_words
    }


def table_widths(column_count: int, available_width: float) -> list[float]:
    ratios_by_count = {
        2: (0.58, 0.42),
        3: (0.56, 0.19, 0.25),
        4: (0.50, 0.14, 0.18, 0.18),
        5: (0.14, 0.40, 0.12, 0.17, 0.17),
    }
    ratios = ratios_by_count.get(column_count)
    if ratios is None:
        ratios = tuple(1 / column_count for _ in range(column_count))
    return [available_width * ratio for ratio in ratios]


def build_table(
    rows: list[list[str]],
    available_width: float,
    style_map: dict[str, ParagraphStyle],
) -> Table:
    if len(rows) >= 2 and is_alignment_row(rows[1]):
        rows.pop(1)
    column_count = len(rows[0])
    if any(len(row) != column_count for row in rows):
        raise ValueError("Markdown table contains inconsistent column counts.")
    right_aligned = numeric_columns(rows[0])
    rendered_rows: list[list[Paragraph]] = []
    for row_index, row in enumerate(rows):
        rendered_rows.append(
            [
                Paragraph(
                    inline_markup(cell),
                    style_map[
                        "cell_header"
                        if row_index == 0
                        else "cell_right" if column_index in right_aligned else "cell"
                    ],
                )
                for column_index, cell in enumerate(row)
            ]
        )

    table = Table(
        rendered_rows,
        colWidths=table_widths(column_count, available_width),
        repeatRows=1,
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
                ("BOX", (0, 0), (-1, -1), 0.6, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.35, LINE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PAPER]),
            ]
        )
    )
    return table


def markdown_story(markdown: str, available_width: float) -> list[Any]:
    style_map = styles()
    lines = markdown.splitlines()
    story: list[Any] = []
    index = 0
    while index < len(lines):
        raw_line = lines[index]
        stripped = raw_line.strip()
        if not stripped:
            story.append(Spacer(1, 4))
            index += 1
            continue
        if stripped.startswith("|"):
            table_rows: list[list[str]] = []
            while index < len(lines) and lines[index].strip().startswith("|"):
                table_rows.append(parse_table_row(lines[index]))
                index += 1
            story.extend(
                [
                    KeepTogether(build_table(table_rows, available_width, style_map)),
                    Spacer(1, 9),
                ]
            )
            continue
        if stripped.startswith("## "):
            story.append(Paragraph(inline_markup(stripped[3:]), style_map["h2"]))
        elif stripped.startswith("# "):
            story.append(Paragraph(inline_markup(stripped[2:]), style_map["h1"]))
        elif stripped.startswith("> "):
            story.append(Paragraph(inline_markup(stripped[2:]), style_map["quote"]))
        else:
            story.append(Paragraph(inline_markup(stripped), style_map["body"]))
        index += 1
    return story


def draw_page_chrome(pdf_canvas: canvas.Canvas, document: SimpleDocTemplate) -> None:
    width, height = LETTER
    pdf_canvas.saveState()
    pdf_canvas.setFillColor(ACCENT)
    pdf_canvas.rect(0, height - 0.18 * inch, width, 0.18 * inch, fill=1, stroke=0)
    pdf_canvas.setStrokeColor(LINE)
    pdf_canvas.line(0.55 * inch, 0.48 * inch, width - 0.55 * inch, 0.48 * inch)
    pdf_canvas.setFillColor(MUTED)
    pdf_canvas.setFont("Helvetica", 7)
    pdf_canvas.drawString(0.55 * inch, 0.28 * inch, "TEST FIXTURE - NOT FOR PAYMENT")
    pdf_canvas.drawRightString(
        width - 0.55 * inch,
        0.28 * inch,
        f"Page {document.page}",
    )
    pdf_canvas.restoreState()


def render_pdf(source: Path, output: Path) -> None:
    markdown = source.read_text(encoding="utf-8")
    output.parent.mkdir(parents=True, exist_ok=True)
    document = SimpleDocTemplate(
        str(output),
        pagesize=LETTER,
        leftMargin=0.62 * inch,
        rightMargin=0.62 * inch,
        topMargin=0.55 * inch,
        bottomMargin=0.65 * inch,
        title=source.stem,
        author="Focused Agent test fixtures",
        creator="scripts/generate-invoice-documents.py",
        pageCompression=1,
    )
    story = markdown_story(markdown, document.width)
    document.build(
        story,
        onFirstPage=draw_page_chrome,
        onLaterPages=draw_page_chrome,
        canvasmaker=DeterministicCanvas,
    )


def page_count(pdf: Path) -> int:
    result = subprocess.run(
        ["pdfinfo", str(pdf)],
        check=True,
        capture_output=True,
        text=True,
    )
    match = re.search(r"^Pages:\s+(\d+)$", result.stdout, re.MULTILINE)
    if not match:
        raise RuntimeError(f"Could not determine page count for {pdf}")
    return int(match.group(1))


def render_pngs(pdf: Path, output_dir: Path, dpi: int) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    prefix = output_dir / pdf.stem
    for stale in output_dir.glob(f"{pdf.stem}-*.png"):
        stale.unlink()
    subprocess.run(
        ["pdftoppm", "-png", "-r", str(dpi), str(pdf), str(prefix)],
        check=True,
        capture_output=True,
    )
    images = sorted(output_dir.glob(f"{pdf.stem}-*.png"))
    if not images:
        raise RuntimeError(f"Poppler produced no PNGs for {pdf}")
    return images


def png_dimensions(path: Path) -> tuple[int, int]:
    with path.open("rb") as image:
        signature = image.read(24)
    if len(signature) != 24 or signature[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"Invalid PNG output: {path}")
    return struct.unpack(">II", signature[16:24])


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file_handle:
        for chunk in iter(lambda: file_handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_commands(commands: Iterable[str]) -> None:
    missing = [command for command in commands if shutil.which(command) is None]
    if missing:
        raise RuntimeError(
            "Missing required command(s): "
            + ", ".join(missing)
            + ". Install Poppler before generating invoice artifacts."
        )


def clean_outputs(pdf_dir: Path, image_dir: Path) -> None:
    for directory, pattern in ((pdf_dir, "*.pdf"), (image_dir, "*.png")):
        if directory.exists():
            for output in directory.glob(pattern):
                output.unlink()


def relative_to_root(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def main() -> int:
    args = parse_args()
    require_commands(("pdfinfo", "pdftoppm"))
    fixtures = load_fixtures(args.input_dir.resolve(), args.fixture)
    pdf_dir = args.pdf_dir.resolve()
    image_dir = args.image_dir.resolve()
    if args.clean:
        clean_outputs(pdf_dir, image_dir)

    TEMP_PDF_OUTPUT.mkdir(parents=True, exist_ok=True)
    artifacts: list[dict[str, Any]] = []
    try:
        for fixture in fixtures:
            retained_pdf = args.format in ("all", "pdf")
            pdf = (
                pdf_dir / f"{fixture.source.stem}.pdf"
                if retained_pdf
                else TEMP_PDF_OUTPUT / f"{fixture.source.stem}.pdf"
            )
            render_pdf(fixture.source, pdf)
            pages = page_count(pdf)
            if pages < 1:
                raise RuntimeError(f"Generated PDF has no pages: {pdf}")

            images: list[Path] = []
            if args.format in ("all", "png"):
                images = render_pngs(pdf, image_dir, args.dpi)
                if len(images) != pages:
                    raise RuntimeError(
                        f"Expected {pages} PNG page(s) for {pdf}, found {len(images)}"
                    )
                for image in images:
                    width, height = png_dimensions(image)
                    if width < 500 or height < 500:
                        raise RuntimeError(f"Generated image is unexpectedly small: {image}")

            artifacts.append(
                {
                    "id": fixture.fixture_id,
                    "source": relative_to_root(fixture.source),
                    "sourceSha256": sha256(fixture.source),
                    "pdf": relative_to_root(pdf) if retained_pdf else None,
                    "pdfSha256": sha256(pdf),
                    "pageCount": pages,
                    "images": [relative_to_root(image) for image in images],
                    "imageSha256": [sha256(image) for image in images],
                }
            )
            print(
                f"generated {fixture.fixture_id}: {pages} PDF page(s), "
                f"{len(images)} PNG page(s)"
            )
    finally:
        if args.format == "png":
            for temporary in TEMP_PDF_OUTPUT.glob("*.pdf"):
                temporary.unlink()

    build_manifest = {
        "version": 1,
        "generator": "scripts/generate-invoice-documents.py",
        "format": args.format,
        "dpi": args.dpi,
        "artifacts": artifacts,
    }
    DEFAULT_BUILD_MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    DEFAULT_BUILD_MANIFEST.write_text(
        json.dumps(build_manifest, indent=2) + "\n", encoding="utf-8"
    )
    print(f"wrote {relative_to_root(DEFAULT_BUILD_MANIFEST)}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError, subprocess.CalledProcessError) as error:
        print(f"invoice fixture generation failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
