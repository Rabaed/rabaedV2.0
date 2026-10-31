// The UAT test sheet's Excel (.xlsx) writer (RP-1163): SpreadsheetML zipped with fflate, with
// screenshots embedded as pictures anchored to their row. Plain JavaScript, so the generator
// inlines it into the sheet's HTML (it drops the word `export`) and the unit test imports it.

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const EMU_PER_PX = 9525;

export function xmlEsc(s) {
  return String(s ?? "")
    // eslint-disable-next-line no-control-regex -- XML 1.0 forbids these characters, so a cell drops them.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

/** A column's letters: 0 is A, 26 is AA. */
export function colName(i) {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sheetXml(sheet, hasDrawing) {
  const heights = sheet.rowHeights ?? {};
  const rows = sheet.table
    .map((row, ri) => {
      const ht = heights[ri] ? ` ht="${heights[ri]}" customHeight="1"` : "";
      const cells = row
        .map((v, ci) => {
          const ref = colName(ci) + (ri + 1);
          const style = ri === 0 ? 1 : 2;
          return typeof v === "number"
            ? `<c r="${ref}" s="${style}"><v>${v}</v></c>`
            : `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
        })
        .join("");
      return `<row r="${ri + 1}"${ht}>${cells}</row>`;
    })
    .join("");
  const last = colName(sheet.table[0].length - 1) + sheet.table.length;
  const cols = sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${MAIN}" xmlns:r="${REL}">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols><sheetData>${rows}</sheetData><autoFilter ref="A1:${last}"/>` +
    (hasDrawing ? `<drawing r:id="rId1"/>` : "") +
    `</worksheet>`
  );
}

function drawingXml(images, firstId) {
  const anchors = images
    .map((img, i) => {
      const id = firstId + i;
      const cx = Math.round(img.width * EMU_PER_PX);
      const cy = Math.round(img.height * EMU_PER_PX);
      return (
        `<xdr:oneCellAnchor><xdr:from><xdr:col>${img.col}</xdr:col><xdr:colOff>${(img.offsetX ?? 0) * EMU_PER_PX}</xdr:colOff><xdr:row>${img.row}</xdr:row><xdr:rowOff>${(img.offsetY ?? 0) * EMU_PER_PX}</xdr:rowOff></xdr:from>` +
        `<xdr:ext cx="${cx}" cy="${cy}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i + 2}" name="Screenshot ${id}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
        `<xdr:blipFill><a:blip r:embed="rId${i + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
        `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`
      );
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}">${anchors}</xdr:wsDr>`;
}

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${MAIN}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>` +
  `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF16213A"/><bgColor indexed="64"/></patternFill></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs></styleSheet>`;

/**
 * The workbook's bytes. `sheets`: { name, table (rows of strings or numbers, the first the
 * header), widths, rowHeights? ({ rowIndex: points }), images? ([{ row, col, data: Uint8Array,
 * ext: "png" | "jpeg", width, height, offsetX?, offsetY? }], row and col 0-based, size in px) }.
 * `zip`: fflate's { zipSync, strToU8 }.
 */
export function buildXlsx(sheets, zip) {
  const enc = (s) => zip.strToU8(s);
  const files = {};
  let mediaCount = 0;
  let drawingCount = 0;
  const overrides = [];
  sheets.forEach((sheet, si) => {
    const images = sheet.images ?? [];
    const hasDrawing = images.length > 0;
    files[`xl/worksheets/sheet${si + 1}.xml`] = enc(sheetXml(sheet, hasDrawing));
    overrides.push(`<Override PartName="/xl/worksheets/sheet${si + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    if (!hasDrawing) return;
    drawingCount += 1;
    const d = drawingCount;
    const first = mediaCount + 1;
    const rels = images.map((img, i) => {
      mediaCount += 1;
      const file = `image${mediaCount}.${img.ext === "jpeg" ? "jpeg" : "png"}`;
      files[`xl/media/${file}`] = img.data;
      return `<Relationship Id="rId${i + 1}" Type="${REL}/image" Target="../media/${file}"/>`;
    });
    files[`xl/drawings/drawing${d}.xml`] = enc(drawingXml(images, first));
    files[`xl/drawings/_rels/drawing${d}.xml.rels`] = enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL}">${rels.join("")}</Relationships>`);
    files[`xl/worksheets/_rels/sheet${si + 1}.xml.rels`] = enc(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/drawing" Target="../drawings/drawing${d}.xml"/></Relationships>`,
    );
    overrides.push(`<Override PartName="/xl/drawings/drawing${d}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
  });
  files["[Content_Types].xml"] = enc(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      `<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides.join("")}</Types>`,
  );
  files["_rels/.rels"] = enc(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  const names = sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
  const filters = sheets
    .map((s, i) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xmlEsc(s.name)}'!$A$1:$${colName(s.table[0].length - 1)}$${s.table.length}</definedName>`)
    .join("");
  files["xl/workbook.xml"] = enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>${names}</sheets><definedNames>${filters}</definedNames></workbook>`);
  files["xl/_rels/workbook.xml.rels"] = enc(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL}">` +
      sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
      `<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
  );
  files["xl/styles.xml"] = enc(STYLES);
  return zip.zipSync(files, { level: 6 });
}
