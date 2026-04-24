from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

from scripts.build_snapshot_sql import (
    archive_daily_snapshot,
    build_dashboard_payload,
    compute_core_daily_snapshot,
    compute_core_weekly_snapshot,
)
from scripts.build_static_html import build_static_dashboard
from scripts.common import (
    PipelineLogger,
    ensure_database_exists,
    execute_sql_file,
    get_connection,
    load_config,
    parse_yyyymmdd,
    resolve_path,
)
from scripts.load_mapping import export_mapping_gaps, load_mapping_dimensions
from scripts.load_sources import detect_report_week, detect_source_files, stage_daily_sources, stage_sources


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="SQL Server core weekly dashboard pipeline")
    parser.add_argument("--config", default="config.json", help="config file path")
    parser.add_argument("--build-snapshot", action="store_true", help="run full pipeline and generate dashboard.html")
    parser.add_argument("--build-daily", action="store_true", help="run daily pipeline")
    parser.add_argument("--stage-only", action="store_true", help="run staging + mapping only")
    parser.add_argument("--export-mapping-gaps", action="store_true", help="run staging + mapping + export gap file")
    parser.add_argument("--archive", action="store_true", help="archive daily hot rows older than keep-months")
    parser.add_argument("--keep-months", type=int, default=12, help="retention months in hot table for daily archive")
    parser.add_argument("--sales-date", default="", help="daily sales date (YYYY-MM-DD or YYYYMMDD)")
    parser.add_argument("--inventory-date", default="", help="daily inventory date (YYYY-MM-DD or YYYYMMDD)")
    return parser.parse_args()


def _parse_date_arg(value: str, field_name: str) -> dt.date:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{field_name} is empty")
    parsed = None
    if len(text) == 10 and "-" in text:
        parsed = dt.date.fromisoformat(text)
    else:
        parsed = parse_yyyymmdd(text)
    if parsed is None:
        raise ValueError(f"invalid {field_name}: {text}")
    return parsed


def main() -> int:
    args = parse_args()
    config = load_config(args.config)

    mode = "build_snapshot"
    if args.build_daily:
        mode = "build_daily"
    if args.stage_only:
        mode = "stage_only"
    if args.export_mapping_gaps:
        mode = "export_mapping_gaps"
    if args.build_snapshot:
        mode = "build_snapshot"
    if args.archive and not any([args.build_snapshot, args.build_daily, args.stage_only, args.export_mapping_gaps]):
        mode = "archive_only"

    base_dir = config.get("_base_dir")
    runtime_dir = resolve_path(config.get("paths", {}).get("runtime_dir", "runtime"), base_dir)
    Path(runtime_dir).mkdir(parents=True, exist_ok=True)

    run_id = dt.datetime.now().strftime("%Y%m%d%H%M%S")
    logger = PipelineLogger(run_id=run_id, runtime_dir=runtime_dir)

    conn = None
    try:
        logger.info("main", "pipeline start", {"mode": mode, "config": config.get("_config_path")})

        ensure_database_exists(config.get("sql", {}))
        conn = get_connection(config.get("sql", {}))

        execute_sql_file(conn, "sql/init_schema.sql")
        logger.info("main", "schema ensured")

        if mode == "archive_only":
            archive_info = archive_daily_snapshot(conn, keep_months=args.keep_months, logger=logger)
            summary = {
                "run_id": run_id,
                "mode": mode,
                "archive": archive_info,
            }
            print(json.dumps(summary, ensure_ascii=False, indent=2))
            logger.info("main", "pipeline done", {"mode": mode})
            logger.flush_to_db(conn)
            return 0

        files = detect_source_files(config, logger)

        if mode == "build_daily":
            inventory_date = _parse_date_arg(args.inventory_date, "inventory_date") if args.inventory_date else detect_report_week(files.stock_csv)
            sales_date = _parse_date_arg(args.sales_date, "sales_date") if args.sales_date else (inventory_date - dt.timedelta(days=1))
            logger.info(
                "main",
                "daily dates resolved",
                {"sales_date": sales_date.isoformat(), "inventory_date": inventory_date.isoformat()},
            )

            stage_stats = stage_daily_sources(conn, files, sales_date, inventory_date, logger)
            mapping_stats = load_mapping_dimensions(conn, config, logger)
            compute_summary = compute_core_daily_snapshot(conn, config, sales_date, inventory_date, logger)
            archive_info = {}
            if args.archive:
                archive_info = archive_daily_snapshot(conn, keep_months=args.keep_months, logger=logger)

            summary = {
                "run_id": run_id,
                "mode": mode,
                "sales_date": sales_date.isoformat(),
                "inventory_date": inventory_date.isoformat(),
                "stage": stage_stats,
                "mapping": mapping_stats,
                "compute": compute_summary,
                "archive": archive_info,
            }
            print(json.dumps(summary, ensure_ascii=False, indent=2))
            logger.info("main", "pipeline done", {"mode": mode})
            logger.flush_to_db(conn)
            return 0

        report_week = detect_report_week(files.stock_csv)
        logger.info("main", "report week detected", {"report_week": report_week.isoformat()})

        stage_stats = stage_sources(conn, files, report_week, logger)
        mapping_stats = load_mapping_dimensions(conn, config, logger)
        gap_info = export_mapping_gaps(conn, report_week, runtime_dir, logger)

        if mode in ("stage_only", "export_mapping_gaps"):
            summary = {
                "run_id": run_id,
                "mode": mode,
                "report_week": report_week.isoformat(),
                "stage": stage_stats,
                "mapping": mapping_stats,
                "mapping_gaps": gap_info,
            }
            print(json.dumps(summary, ensure_ascii=False, indent=2))
            logger.info("main", "pipeline done", {"mode": mode})
            logger.flush_to_db(conn)
            return 0

        compute_summary = compute_core_weekly_snapshot(conn, config, report_week, logger)
        payload = build_dashboard_payload(
            conn,
            window_weeks=int(config.get("history", {}).get("window_weeks", 52)),
            mapping_gaps=gap_info,
        )

        payload_path = Path(runtime_dir) / "dashboard_payload.json"
        payload_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

        html_path = build_static_dashboard(config, payload, logger)

        summary = {
            "run_id": run_id,
            "mode": mode,
            "report_week": report_week.isoformat(),
            "stage": stage_stats,
            "mapping": mapping_stats,
            "mapping_gaps": gap_info,
            "compute": compute_summary,
            "snapshot": html_path,
        }
        print(json.dumps(summary, ensure_ascii=False, indent=2))

        logger.info("main", "pipeline done", {"snapshot": html_path})
        logger.flush_to_db(conn)
        return 0

    except Exception as exc:
        logger.error("main", f"pipeline failed: {exc}")
        if conn is not None:
            try:
                logger.flush_to_db(conn)
            except Exception:
                pass
        return 1
    finally:
        if conn is not None:
            conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
