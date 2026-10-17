# Builds the made-up submittal registers the spreadsheet reader's tests read (RP-635).
# Made-up data only. Run from the repo root, with openpyxl installed:
#   python apps/api/test/fixtures/registers/make-fixtures.py
# The .csv files are written by hand-picked bytes, so their encoding, BOM and
# delimiter are exactly what the tests name.

import datetime
import os
import zipfile

from openpyxl import Workbook

here = os.path.dirname(os.path.abspath(__file__))


def path(name):
    return os.path.join(here, name)


def register_xlsx():
    """Two sheets. "Register" has a title block above its header (row 4), a header merged over
    two columns (Trade over D:E), an empty row, Arabic and English text, a date and numbers."""
    book = Workbook()
    notes = book.active
    notes.title = "Notes"
    notes["A1"] = "Read me first"
    sheet = book.create_sheet("Register")
    sheet["A1"] = "Tower Project: Submittal Register"
    sheet.merge_cells("A1:F1")
    sheet["A2"] = "سجل المخططات والمواد"
    # Row 3 is empty.
    for column, header in zip("ABCDF", ["No.", "Subject", "الموضوع", "Trade", "Planned"]):
        sheet[f"{column}4"] = header
    sheet.merge_cells("D4:E4")
    rows = [
        (5, ["0012", "Shop drawings: lobby ceiling", "مخططات تنفيذية: سقف الردهة", "Architectural", "Ceilings", datetime.date(2026, 3, 15)]),
        (6, [7, "Fire pump datasheet", "بيانات مضخة الحريق", "Mechanical", "Fire fighting", datetime.datetime(2026, 4, 2, 9, 30)]),
        # Row 7 is empty.
        (8, [1.5, "  Cable trays, level 3  ", "حوامل الكابلات", "Electrical", None, None]),
    ]
    for row, values in rows:
        for column, value in zip("ABCDEF", values):
            if value is not None:
                sheet[f"{column}{row}"] = value
    sheet["F5"].number_format = "dd/mm/yyyy"
    sheet["F6"].number_format = "dd/mm/yyyy hh:mm"
    sheet["A8"].number_format = "0.00"
    book.save(path("register.xlsx"))


def too_many_rows_xlsx():
    """A header and 2,001 data rows: one over the limit."""
    book = Workbook()
    sheet = book.active
    sheet.title = "Register"
    sheet.append(["Subject", "Trade"])
    for n in range(1, 2002):
        sheet.append([f"Submittal {n}", "Electrical"])
    book.save(path("too-many-rows.xlsx"))


def inflated_xlsx():
    """A valid one-sheet workbook carrying a part that inflates to 101 MB: small on disk, huge in memory."""
    book = Workbook()
    book.active.title = "Register"
    book.active["A1"] = "Subject"
    book.save(path("inflated.xlsx"))
    with zipfile.ZipFile(path("inflated.xlsx"), "a", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        archive.writestr("xl/media/padding.bin", b"\0" * (101 * 1024 * 1024))


def write_bytes(name, data):
    with open(path(name), "wb") as file:
        file.write(data)


def csv_files():
    # UTF-8 with a BOM, comma-delimited, CRLF, a title line above the header, an empty line,
    # a quoted field holding a comma and a line break, and a header merged-looking (an empty header cell).
    comma = (
        "Tower Project: Submittal Register,,,\r\n"
        "No.,Subject,الموضوع,Trade,\r\n"
        "0012,Shop drawings: lobby ceiling,مخططات تنفيذية: سقف الردهة,Architectural,Ceilings\r\n"
        "\r\n"
        '7,"Fire pump datasheet, rev 2","بيانات مضخة الحريق\r\nالمراجعة 2",Mechanical,Fire fighting\r\n'
    )
    write_bytes("register-comma.csv", b"\xef\xbb\xbf" + comma.encode("utf-8"))
    # UTF-8 without a BOM, semicolon-delimited (as Excel saves in Arabic and European locales), LF,
    # with commas inside the values.
    semicolon = (
        "Subject;Trade;Scopes\n"
        "Doors, frames and ironmongery;Architectural;Doors, Ironmongery\n"
        "لوحات التوزيع، الدور الأرضي;Electrical;Panels\n"
    )
    write_bytes("register-semicolon.csv", semicolon.encode("utf-8"))
    # Arabic saved as Windows-1256, the encoding Excel's plain "CSV" uses on an Arabic Windows: not UTF-8.
    write_bytes("register-windows-1256.csv", "Subject,الموضوع\nPanels,لوحات التوزيع\n".encode("cp1256"))


register_xlsx()
too_many_rows_xlsx()
inflated_xlsx()
csv_files()
