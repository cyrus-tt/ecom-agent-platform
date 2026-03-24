# PostgreSQL Daily Wide Table

This folder now contains a PostgreSQL-ready daily wide-table pipeline that matches the latest mapping workbook and the confirmed business rules.

Current workspace convention:
- Raw input files are placed in `../../data/inbox`
- Prepared CSV output is written to `../../data/prepared`

## Confirmed rules

- Inventory keeps only the latest snapshot.
- Sales keeps history by day.
- Fact tables keep all SKUs, including `u` / `v`; report queries still exclude them from the final report, case-insensitive.
- If a SKU is missing in product master, the row is still kept and descriptive fields remain `NULL`.
- `故事包` is intentionally left empty for now.
- Net sales use `销售单 + 退货单 + 换货单`.
- Inventory mappings with `不可用` are excluded from inventory columns.
- Sales mappings with `删除` are excluded from sales and discount columns.
- Unmapped pools or stores fall back to `其他`.

## Files

- `prepare_pg_sources.py`
  - Reads source CSV/XLSX from `../../data/inbox`
  - Writes UTF-8 prepared CSV files to `../../data/prepared`
- `01_postgres_daily_wide_ddl.sql`
  - Creates the PostgreSQL schema, source tables, final report table, and export view.
- `02_postgres_daily_wide_load.sql`
  - Loads `../../data/prepared/*.csv` into PostgreSQL via `psql \copy`.
- `03_postgres_daily_wide_etl.sql`
  - Legacy wide-table rebuild. Optional only when `rpt_daily_sku_wide` / legacy export views must be refreshed.
- `04_postgres_daily_wide_display_view.sql`
  - Creates a display-focused view where inventory/sales are integers and discounts are percentage text.
- `05_postgres_split_daily_wide.sql`
  - Builds the optimized split model:
    - `anta_daily.rpt_sales_sku_daily` (sales fact table, `sales_date + sku` grain, latest import dates only, keeps additive qty/amount facts)
    - `anta_daily.rpt_inventory_sku_latest` (latest inventory wide table, sku grain)
  - This is used by `/report` and `/report-daily` for union-mode querying (`latest inventory ∪ selected-range sales`).

## Why the export view uses prefixed Chinese columns

The Excel header repeats names like `女子`, `户外`, and `潮流` across inventory, sales, SKU discount, and style discount sections. PostgreSQL views cannot expose duplicate column names, so the export view uses unique names such as:

- `库存_女子`
- `销售_女子`
- `货号折扣_女子`
- `款号折扣_女子`

The column order still follows the same four sections as the Excel header.

## Run order

1. Run `python prepare_pg_sources.py`
2. Run `01_postgres_daily_wide_ddl.sql`
3. Run `02_postgres_daily_wide_load.sql` with `psql`
4. Run `05_postgres_split_daily_wide.sql`

Optional legacy maintenance:

1. Run `03_postgres_daily_wide_etl.sql`
2. Run `04_postgres_daily_wide_display_view.sql`

## Example

```powershell
# run from project root
powershell -NoProfile -ExecutionPolicy Bypass -File .\ops\windows\run_pg_pipeline.ps1
```
