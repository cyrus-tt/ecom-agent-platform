from __future__ import annotations

import datetime as dt
import json
import os
import re
from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import pyodbc


BASE_DIR = Path(__file__).resolve().parents[1]


DEFAULT_CONFIG: Dict[str, Any] = {
    "sql": {
        "server": "localhost",
        "database": "ecom_dashboard_v2",
        "driver": "ODBC Driver 18 for SQL Server",
        "trusted_connection": True,
        "encrypt": False,
        "trust_server_certificate": True,
    },
    "paths": {
        "data_dir": ".",
        "runtime_dir": "runtime",
        "web_dir": "web",
        "snapshot_path": "dashboard.html",
    },
    "sources": {
        "stock_file": "",
        "pool_file": "",
        "sales_file": "",
        "product_info_file": "",
    },
    "mapping": {
        "workbook_path": r"D:\周报数据源\品类周报数据源.xlsx",
    },
    "history": {
        "window_weeks": 52,
    },
    "rules": {
        "new_sku_min_available_qty": 50,
        "skip_sku_contains": ["U", "V"],
    },
}


def _deep_merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    result = dict(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def load_config(config_path: str) -> Dict[str, Any]:
    path = Path(config_path)
    if not path.is_absolute():
        path = (BASE_DIR / path).resolve()
    with path.open("r", encoding="utf-8-sig") as f:
        raw = json.load(f)
    cfg = _deep_merge(DEFAULT_CONFIG, raw)
    cfg["_config_path"] = str(path)
    cfg["_base_dir"] = str(path.parent)
    return cfg


def resolve_path(value: str, base_dir: Optional[str] = None) -> str:
    text = (value or "").strip()
    if not text:
        return ""
    p = Path(text)
    if p.is_absolute():
        return str(p)
    root = Path(base_dir or BASE_DIR)
    return str((root / p).resolve())


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def normalize_code(value: Any) -> str:
    text = normalize_text(value).upper()
    if not text:
        return ""
    return re.sub(r"\.0+$", "", text)


def to_float(value: Any) -> float:
    if value in (None, ""):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    text = normalize_text(value).replace(",", "")
    if not text:
        return 0.0
    try:
        return float(text)
    except Exception:
        return 0.0


def round_half_up(value: float) -> float:
    return float(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def safe_ratio(numerator: float, denominator: float) -> float:
    den = to_float(denominator)
    if den == 0:
        return 0.0
    return round(to_float(numerator) / den, 6)


def parse_yyyymmdd(value: Any) -> Optional[dt.date]:
    text = normalize_text(value)
    if not text:
        return None
    digits = re.sub(r"\D", "", text)
    if re.fullmatch(r"\d{8}", digits):
        try:
            return dt.datetime.strptime(digits, "%Y%m%d").date()
        except ValueError:
            return None
    return None


def extract_date_token(text: str) -> str:
    m = re.search(r"(20\d{6})", normalize_text(text))
    return m.group(1) if m else ""


def quote_ident(name: str) -> str:
    return "[" + (name or "").replace("]", "]]" ) + "]"


def build_connection_string(sql_cfg: Dict[str, Any], database: Optional[str] = None) -> str:
    db_name = database or sql_cfg.get("database", "")
    parts = [
        f"DRIVER={{{sql_cfg.get('driver', 'ODBC Driver 18 for SQL Server')}}}",
        f"SERVER={sql_cfg.get('server', 'localhost')}",
        f"DATABASE={db_name}",
    ]
    if sql_cfg.get("trusted_connection", True):
        parts.append("Trusted_Connection=yes")
    if sql_cfg.get("encrypt", False):
        parts.append("Encrypt=yes")
    else:
        parts.append("Encrypt=no")
    if sql_cfg.get("trust_server_certificate", True):
        parts.append("TrustServerCertificate=yes")
    return ";".join(parts)


def get_connection(sql_cfg: Dict[str, Any], database: Optional[str] = None, autocommit: bool = False) -> pyodbc.Connection:
    conn_str = build_connection_string(sql_cfg, database=database)
    return pyodbc.connect(conn_str, autocommit=autocommit)


def ensure_database_exists(sql_cfg: Dict[str, Any]) -> None:
    database = sql_cfg.get("database", "")
    if not database:
        raise ValueError("sql.database is empty")
    with get_connection(sql_cfg, database="master", autocommit=True) as conn:
        cur = conn.cursor()
        cur.execute("SELECT DB_ID(?)", (database,))
        exists = cur.fetchone()[0]
        if exists is None:
            cur.execute(f"CREATE DATABASE {quote_ident(database)}")


def split_sql_batches(sql_text: str) -> List[str]:
    batches: List[str] = []
    buf: List[str] = []
    for line in sql_text.splitlines():
        if line.strip().upper() == "GO":
            statement = "\n".join(buf).strip()
            if statement:
                batches.append(statement)
            buf = []
        else:
            buf.append(line)
    tail = "\n".join(buf).strip()
    if tail:
        batches.append(tail)
    return batches


def execute_sql_file(conn: pyodbc.Connection, sql_path: str) -> None:
    path = Path(sql_path)
    if not path.is_absolute():
        path = (BASE_DIR / path).resolve()
    text = path.read_text(encoding="utf-8").lstrip("\ufeff")
    cur = conn.cursor()
    for stmt in split_sql_batches(text):
        cur.execute(stmt)
    conn.commit()


@dataclass
class PipelineLogger:
    run_id: str
    runtime_dir: str
    records: List[Dict[str, Any]] = field(default_factory=list)

    def __post_init__(self) -> None:
        path = Path(self.runtime_dir)
        path.mkdir(parents=True, exist_ok=True)
        self.log_file = path / f"etl_run_{self.run_id}.log"

    def log(self, level: str, step: str, message: str, extra: Optional[Dict[str, Any]] = None) -> None:
        entry = {
            "time": dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "level": (level or "INFO").upper(),
            "step": step or "main",
            "message": str(message),
            "extra": extra or {},
        }
        self.records.append(entry)
        line = f"[{entry['time']}] [{entry['level']}] [{entry['step']}] {entry['message']}"
        print(line)
        with self.log_file.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
            if entry["extra"]:
                f.write("  extra=" + json.dumps(entry["extra"], ensure_ascii=False) + "\n")

    def info(self, step: str, message: str, extra: Optional[Dict[str, Any]] = None) -> None:
        self.log("INFO", step, message, extra=extra)

    def warn(self, step: str, message: str, extra: Optional[Dict[str, Any]] = None) -> None:
        self.log("WARN", step, message, extra=extra)

    def error(self, step: str, message: str, extra: Optional[Dict[str, Any]] = None) -> None:
        self.log("ERROR", step, message, extra=extra)

    def flush_to_db(self, conn: pyodbc.Connection) -> None:
        if not self.records:
            return
        cur = conn.cursor()
        rows = [
            (
                self.run_id,
                rec["time"],
                rec["level"],
                rec["step"],
                rec["message"][:1000],
                json.dumps(rec.get("extra") or {}, ensure_ascii=False),
            )
            for rec in self.records
        ]
        cur.fast_executemany = True
        cur.executemany(
            """
            INSERT INTO dbo.etl_run_log(run_id, log_time, level, step, message, extra_json)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        conn.commit()


def iter_chunked(rows: Iterable[Any], size: int = 5000) -> Iterable[List[Any]]:
    bucket: List[Any] = []
    for row in rows:
        bucket.append(row)
        if len(bucket) >= size:
            yield bucket
            bucket = []
    if bucket:
        yield bucket
