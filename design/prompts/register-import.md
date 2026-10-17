Design the **Submittal Register Import** for Rabaed, a B2B construction management web app used in Saudi Arabia (Arabic and English, full RTL support, Latin digits). Desktop. Use the Rabaed Claude Design kit (app shell, page templates, tokens) already in the project. RP-634, spec RP-631.

## Context
At the start of a project, the Contractor (or a Subcontractor) already has its **submittal register**: a spreadsheet listing every submittal it plans to send (material, supplier and document approvals). The import turns that list into **Draft** submittals in Rabaed in one go, instead of creating them one by one.

- It reads `.xlsx` and `.csv`.
- Each good row becomes one Draft submittal (a Draft has no Document Number yet; it gets one when it leaves Draft). Nothing is created until the Member confirms.
- On confirm, every good row is created together, or none is. Rows with errors are **left out** (never created) and can be **downloaded** to fix and import again as a new import.
- Rows can be grouped into **Packages** (a named group of submittals followed together, numbered `PKG-001`): one Package for the whole file, or one per value of a column; a new Package, or an existing **Open** one.
- Every import is **kept** with exactly what it created, so any Member of the importing company can check it later.
- A Rabaed Engineer (Rabaed's own staff, in the separate **Rabaed Admin** app) can run the same import for a company, with a reason.

**Visibility rule (critical):** an import belongs to the company it was run for. The import, its rows, its file and its saved mappings are seen only by that company's Members (and by Rabaed Engineers in Rabaed Admin). The Drafts it creates follow the usual Draft rules (by the Workflow's setting, the rest of the company reads a Draft, or only its raiser does), so a created row links to its Draft only where the viewer can see it. Never show another company's imports, files, mappings or Drafts.

Say **Import register** / **import**; never "bulk upload" or "migration".

## What to design

### 1. The wizard (Submittals module → "Import register")
1. **Upload:** drag and drop or browse; `.xlsx` or `.csv`; a link to download a template.
2. **Sheet and header row:** pick the sheet (for `.xlsx`) and which row holds the column names, with a preview of the first rows.
3. **Mapping:** each spreadsheet column → a Rabaed field: Subject, Type (MAR / SAR / DAR), Trade, Scopes, Location, Package, Assign to, Paper ref, and the Type's Form fields (simple field types only). Subject, Type and Trade are required; unmapped columns are ignored. Rabaed suggests a match for each column ("Description → Subject, 92%"). Alternatively, set a **fixed** Type or Trade for every row. **Unknown values** are matched **once** per distinct value ("Elec." → Electrical; "Lvl 3" → Tower 1 / Floor 3), not per row.
4. **Preview:** counts "182 rows ready · 7 rows with errors". Every bad row lists **every** reason ("Trade 'HVAC-2' unknown; Subject empty"). **Assign to:** the Drafts are raised by the importer by default; pick a Member of the same company for a group of rows (e.g. all Electrical rows → Faisal), or use an "Assign to" column of emails. An assignee who can't create the Type or doesn't cover the row's Trade makes the row bad. **Package choice:** one Package for the file, or by a column; new or an existing Open one (a Package that is In Progress or Done makes its rows bad). **Back to mapping** to change it and preview again.
5. **Confirm:** a summary of what will be created (Drafts by Type and Trade, Packages new / existing), and the button "Create 182 Drafts".
6. **Result:** created counts with links (to the Drafts list filtered to this import, and to each Package), and **"Download rejected rows"** (the 7 rows plus a reason column).

### 2. Imports page
- The project's imports by the viewer's company: who, when, file name, rows created / rejected, Packages created or used.
- One import's page: every row with its result (created → link to the Draft; rejected → reasons), the mapping it used ("Save as mapping", named, to reuse it next time), and downloads of the original file and the rejected rows.

### 3. Rabaed Admin variant
- The same wizard in Rabaed Admin, where a Rabaed Engineer first picks the **Project** and the **company** (Participant) the import is for, a **default Member** of that company who raises the Drafts (an "Assign to" value overrides it per row), and a **reason** (required, kept with the import). Show it in the Rabaed Admin shell, not the project app. In the project app, the company's Members see **"Rabaed"** as who imported, never the Engineer's name.

## Screens to produce
- Every wizard step, including a **preview with bad rows** and the unknown-value matching.
- The Imports page and one import's page.
- The Rabaed Admin variant (pick company and reason, then the mapping step).
- Every screen in **English and Arabic (RTL)**. Document and Package numbers stay LTR inside Arabic text.
