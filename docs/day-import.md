# One-off day import from a CSV file (NUD-155)

For the day the route only exists as a handwritten sheet: the office types it into a spreadsheet,
saves it as CSV and one command turns every row into a **confirmed order** for the day. Afterwards
the normal flow applies (plan the tour, release it, the driver opens it).

The tool is one file, `scripts/import-day-orders.ts`. It is a **dry run by default**: it prints what
it would do and writes nothing until you add `--apply`.

## 1. The CSV file

Exactly this header, semicolon separated, UTF-8 (Excel's "CSV UTF-8 (Comma delimited)"; a BOM, CRLF
line ends and empty rows or columns at the end are fine):

```
customerNumber;menge;Karton;notizen
1006;3;ja;R · 35 €
1049;4;nein;
1073;6;nein;bar 6 €
```

| Column           | Rule                                                                                                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `customerNumber` | Must be the number of an **existing, active** customer (the `1xxx` number). Names are never guessed.                                                                                   |
| `menge`          | Whole number from 1 to 9999. `2,5`, `0`, negative numbers and text are errors.                                                                                                         |
| `Karton`         | `ja` = product `NUDELN-KARTON` (Nudeln, 10 kg, Karton). `nein` = product `NUDELN-BEUTEL` (Nudeln, 3 kg, Beutel). Upper/lower case and spaces do not matter, anything else is an error. |
| `notizen`        | Optional. Goes into the customer's driver note ("Hinweise für den Fahrer"), e.g. `R` (printed bill) and cash amounts. A note with a `;` must be in double quotes: `"Hof; R"`.          |

- One row = one confirmed order with one product. A customer may appear several times: that gives
  several orders, and the tour planner merges them into **one stop** for that customer and day.
- The orders are for one whole day (delivery window = that day, no times).
- A sample file: [`docs/examples/day-import-sample.csv`](./examples/day-import-sample.csv).

### What happens to `notizen`

The note belongs to the **customer** and stays until someone deletes it (Kunden > Kunde > Hinweise).

| Customer's current note   | CSV `notizen`               | Result                                 |
| ------------------------- | --------------------------- | -------------------------------------- |
| any                       | empty                       | untouched                              |
| empty                     | `R`                         | set to `R`                             |
| `Hintereingang`           | `R · 35 €`                  | `Hintereingang \| R · 35 €` (appended) |
| already contains the text | the same text               | untouched (no double entry)            |
| any                       | any, with `--replace-notes` | replaced by the CSV text               |

It is saved like an edit in the customer form: German is the source, the other languages are filled
in by the translation retry job within a few minutes (`--translate-now` does it immediately, needs
`DEEPL_API_KEY`). Until then the driver sees the German text.

## 2. Get the file onto the server

On the office PC (PowerShell; adjust the user and address):

```powershell
scp .\tag-2026-10-27.csv root@<server>:/opt/delivery-app/tag.csv
```

The first time (or when the tool changed) copy the script too, **no rebuild needed**:

```powershell
scp .\scripts\import-day-orders.ts root@<server>:/opt/delivery-app/scripts/import-day-orders.ts
```

## 3. Dry run first, then apply

On the server:

```bash
cd /opt/delivery-app && set -a && . /etc/delivery-app.env && set +a

# 1. Dry run: prints a table, writes nothing. Today in Europe/Vienna unless --date is given.
pnpm tsx scripts/import-day-orders.ts tag.csv
pnpm tsx scripts/import-day-orders.ts tag.csv --date 2026-10-28

# 2. Fix the file until there is no ERROR row, then create the orders:
pnpm tsx scripts/import-day-orders.ts tag.csv --apply
```

The table shows per row: row number (spreadsheet row, the header is row 1), customer number, name,
city, product, quantity, what happens to the note (`none`, `set`, `append`, `unchanged`, `replace`)
and `OK` or `ERROR: <reason>`. Below it: warnings and a summary.

Warnings never block:

- _no address point and no Parkplatz: no navigation button until geocoded_ – the driver sees the
  stop but gets no navigation button. Add a Parkplatz or fix the address (Kunden).
- _customer already has N confirmed order(s) for this day_ – the new order is added; they merge
  into one stop. Check that the row is not a duplicate of an order entered by hand.
- _customer appears several times in the file_.

### Options

| Option              | Meaning                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `--date YYYY-MM-DD` | Delivery day (default today, factory time zone). A day in the past is refused.                                      |
| `--apply`           | Really create the orders and save the notes. Without it nothing is written.                                         |
| `--skip-errors`     | With `--apply`: leave the rows with errors out (they are listed). Without it any error row refuses the whole apply. |
| `--replace-notes`   | Overwrite existing customer notes instead of appending.                                                             |
| `--resume`          | Finish a file whose earlier run stopped half way (see below).                                                       |
| `--actor <email>`   | ADMIN user the orders are attributed to (default: the first active admin).                                          |
| `--translate-now`   | Translate the notes immediately instead of by the retry job.                                                        |

Exit code `0` = fine, `1` = bad file / setup, `2` = refused or error rows (nothing written),
`3` = an apply stopped half way.

### Safety

- **Applying the same file for the same day twice is refused.** Every created order carries the
  marker `CSV day import <file hash> <day> row <n>` in its internal note (visible in the order
  detail). The dry run tells you when a file was already imported. To import the same sheet for
  another day, use another `--date`; to import changed content, save it as a new file.
- Each order is its own transaction (with its audit entry and the "tour outdated" flag, exactly
  like the office form). If a run stops half way, the output says at which row, lists what was
  created and exits with `3`. Fix the cause, then run the **same command plus `--resume`**: only
  rows without an order are created.
- Nothing is ever deleted. Deactivated customers are row errors.
- Run one import at a time.
- To undo a mistake use the office: cancel the order (Bestellungen) or fix the customer note.

## 4. What the office does afterwards

The command prints the same list at the end:

1. **Bestellungen**: the orders of the day are listed as confirmed.
2. **Touren > Touren planen**: choose vehicle and driver, "Jetzt planen", check the stops and their
   order.
3. **Touren > Freigeben**: now the driver sees the tour.

If the tour of that day was already released, the import marks it as outdated; release it again.
