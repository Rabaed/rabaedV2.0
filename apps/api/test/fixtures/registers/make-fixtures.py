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


def formats_xlsx():
    """Numbers and times whose stored value differs from what Excel shows."""
    book = Workbook()
    sheet = book.active
    sheet.title = "Formats"
    sheet.append(["Shown as", "Value"])
    sheet.append(["09:30", datetime.time(9, 30)])
    sheet["B2"].number_format = "hh:mm"
    # What Excel stores for =0.1+0.2, and shows as 0.3.
    sheet.append(["0.3", 0.1 + 0.2])
    sheet.append(["0012", 12])
    sheet["B4"].number_format = "0000"
    sheet.append(["15%", 0.15])
    sheet["B5"].number_format = "0%"
    # A reference typed as text that only looks like a number: never rounded.
    sheet.append(["12345678901234567890", "12345678901234567890"])
    book.save(path("formats.xlsx"))


def forged_sizes_xlsx():
    """A sheet that inflates to 101 MB while the zip says it is as small as before: a zip bomb
    that a check of the stated sizes alone would let through."""
    book = Workbook()
    book.active.title = "Register"
    book.active.append(["Subject"])
    book.active.append(["Panels"])
    book.save(path("forged-sizes.xlsx"))
    name = "xl/worksheets/sheet1.xml"
    with zipfile.ZipFile(path("forged-sizes.xlsx")) as archive:
        parts = {info.filename: archive.read(info.filename) for info in archive.infolist()}
    honest = len(parts[name])
    # openpyxl writes the sheet with no XML declaration: whitespace before its root element is well-formed.
    parts[name] = b" " * (101 * 1024 * 1024) + parts[name]
    with zipfile.ZipFile(path("forged-sizes.xlsx"), "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for part, data in parts.items():
            archive.writestr(part, data)
    data = bytearray(open(path("forged-sizes.xlsx"), "rb").read())
    encoded = name.encode()
    # Each record's signature, then where its uncompressed size, name length and name sit:
    # the local file header, and the central directory entry.
    for signature, size_at, name_length_at, name_at in ((b"PK\x03\x04", 22, 26, 30), (b"PK\x01\x02", 24, 28, 46)):
        at = data.find(signature)
        while at >= 0:
            length = int.from_bytes(data[at + name_length_at : at + name_length_at + 2], "little")
            if bytes(data[at + name_at : at + name_at + length]) == encoded:
                data[at + size_at : at + size_at + 4] = honest.to_bytes(4, "little")
            at = data.find(signature, at + 4)
    write_bytes("forged-sizes.xlsx", bytes(data))


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
formats_xlsx()
inflated_xlsx()
forged_sizes_xlsx()
csv_files()
