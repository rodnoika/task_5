# Formula-only generator

Open `../public/generator.xlsx` or import it into Google Sheets. All parameters are on **Control Room**. Yellow cells are editable.

| Cells | Parameter |
| --- | --- |
| B1, D1 | Start and end date |
| B2 | Active mine count, 1–12 |
| D2 | Random seed |
| B5 | Normal or Uniform distribution |
| B6, D6 | Calculated active distribution parameters |
| B7, D7 | Normal mean and standard deviation |
| B8, D8 | Uniform minimum and maximum |
| B9 | Correlation, 0–0.98 |
| D9 | Daily growth |
| G4:H15 | Mine names and capacity factors |
| A13:D16 | Four events: date, days, peak factor, probability |
| B19:H19 | Monday–Sunday output factors |

The chart below the inputs shows total daily output. **Data** contains Date, Total and the active mine columns for CSV export. **Process** contains the calculation steps. The generator supports up to 730 days.

Mine names must be unique among active mines, at most 80 characters and different from `Total`. The same seed and inputs reproduce the same output.

Model equations are described in `../docs/methodology.md`.
