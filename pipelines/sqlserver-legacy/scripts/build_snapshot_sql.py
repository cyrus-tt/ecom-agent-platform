from __future__ import annotations

import datetime as dt
import json
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from .common import normalize_code, normalize_text, round_half_up, safe_ratio, to_float


INVENTORY_CHANNELS = [
    "女子",
    "跑步",
    "篮球",
    "滑板",
    "C店",
    "品类共享",
    "天猫奥莱",
    "新品共享",
    "共享仓",
    "降解共享",
    "线下奥莱共享",
    "天猫旗舰",
    "京东旗舰",
    "社交",
    "天猫专卖",
    "京东专卖",
    "上海专卖",
    "得物",
    "京自营",
    "唯品",
    "PDD",
    "官网",
    "经销",
    "降解独享仓",
]

SALES_CHANNELS = [
    "天猫奥莱",
    "女子旗舰",
    "篮球旗舰",
    "跑步旗舰",
    "滑板旗舰",
    "天猫羽球",
    "奥莱安建立",
    "C店",
    "天猫旗舰",
    "唯品",
    "拼多多",
    "社交",
    "京东旗舰",
    "天猫专卖",
    "京东专卖",
    "上海专卖",
    "得物",
    "官网",
]

DAILY_WIDE_COLUMNS = [
    "sales_date",
    "sku",
    "inventory_date",
    "style",
    "major_category",
    "category",
    "product_name",
    "tag_price",
    "season",
    "gender",
    "story_pack",
    "color",
    "category_exclusive_qty",
    "category_available_qty",
    "pool_sync_qty",
    "olai_sync_qty",
    "full_stock_qty",
    "ecommerce_sales_qty",
    "sales_amt_total",
    "tag_amt_total",
    "sku_discount",
    "style_discount",
    "inventory_json",
    "sales_json",
    "sku_discount_json",
    "style_discount_json",
    "promo_impressions",
    "promo_clicks",
    "promo_spend",
    "promo_gmv",
]


def _derive_style(sku: str) -> str:
    if not sku:
        return ""
    if "-" in sku:
        return sku.split("-", 1)[0]
    return sku


def _format_month_day(value: Optional[dt.date]) -> str:
    if value is None:
        return ""
    return f"{value.month}.{value.day}"


def _build_sales_period_label(date_from: Optional[dt.date], date_to: Optional[dt.date]) -> str:
    if date_from is None and date_to is None:
        return ""
    if date_from is None:
        return _format_month_day(date_to)
    if date_to is None:
        return _format_month_day(date_from)
    return f"{_format_month_day(date_from)}--{_format_month_day(date_to)}"


def _load_dims(conn) -> Dict[str, Dict]:
    cur = conn.cursor()

    cur.execute("SELECT pool_name, channel, ISNULL(remark, '') FROM dbo.dim_pool_channel")
    pool_channel = {}
    pool_remark = {}
    for row in cur.fetchall():
        pool = normalize_text(row[0])
        if not pool:
            continue
        pool_channel[pool] = normalize_text(row[1])
        pool_remark[pool] = normalize_text(row[2])

    cur.execute("SELECT store_name, channel FROM dbo.dim_store_channel")
    store_channel = {}
    for row in cur.fetchall():
        store = normalize_text(row[0])
        if store:
            store_channel[store] = normalize_text(row[1])

    cur.execute("SELECT pool_name, sync_ratio FROM dbo.dim_pool_ratio")
    pool_ratio = {}
    for row in cur.fetchall():
        pool = normalize_text(row[0])
        if pool:
            pool_ratio[pool] = to_float(row[1])

    return {
        "pool_channel": pool_channel,
        "pool_remark": pool_remark,
        "store_channel": store_channel,
        "pool_ratio": pool_ratio,
    }


def _load_product_info(conn, report_week: dt.date) -> Dict[str, Dict]:
    cur = conn.cursor()
    cur.execute(
        """
        SELECT sku, style, major_category, category, product_name, tag_price, season, gender, story_pack, color
        FROM dbo.stg_product_info
        WHERE report_week = ?
        """,
        (report_week,),
    )

    info: Dict[str, Dict] = {}
    for row in cur.fetchall():
        sku = normalize_code(row[0])
        if not sku:
            continue
        rec = info.setdefault(
            sku,
            {
                "style": "",
                "major_category": "",
                "category": "",
                "product_name": "",
                "tag_price": 0.0,
                "season": "",
                "gender": "",
                "story_pack": "",
                "color": "",
            },
        )
        if not rec["style"]:
            rec["style"] = normalize_code(row[1])
        if not rec["major_category"]:
            rec["major_category"] = normalize_text(row[2])
        if not rec["category"]:
            rec["category"] = normalize_text(row[3])
        if not rec["product_name"]:
            rec["product_name"] = normalize_text(row[4])
        if rec["tag_price"] == 0:
            rec["tag_price"] = to_float(row[5])
        if not rec["season"]:
            rec["season"] = normalize_text(row[6])
        if not rec["gender"]:
            rec["gender"] = normalize_text(row[7])
        if not rec["story_pack"]:
            rec["story_pack"] = normalize_text(row[8])
        if not rec["color"]:
            rec["color"] = normalize_text(row[9])

    for sku, rec in info.items():
        if not rec["style"]:
            rec["style"] = _derive_style(sku)
    return info


def _load_previous_baseline_skus(conn, report_week: dt.date) -> List[str]:
    cur = conn.cursor()
    cur.execute("SELECT MAX(report_week) FROM dbo.rpt_core_weekly_snapshot WHERE report_week < ?", (report_week,))
    row = cur.fetchone()
    baseline_week = row[0] if row else None
    if baseline_week is None:
        return []
    cur.execute(
        "SELECT sku FROM dbo.rpt_core_weekly_snapshot WHERE report_week = ? ORDER BY sku",
        (baseline_week,),
    )
    return [normalize_code(r[0]) for r in cur.fetchall() if normalize_code(r[0])]


def _load_product_info_for_daily(conn, inventory_date: dt.date) -> Dict[str, Dict]:
    info = _load_product_info(conn, inventory_date)
    if info:
        return info

    cur = conn.cursor()
    cur.execute(
        "SELECT MAX(report_week) FROM dbo.stg_product_info WHERE report_week <= ?",
        (inventory_date,),
    )
    row = cur.fetchone()
    latest_week = row[0] if row else None
    if latest_week is None:
        cur.execute("SELECT MAX(report_week) FROM dbo.stg_product_info")
        row = cur.fetchone()
        latest_week = row[0] if row else None
    if latest_week is None:
        return {}
    return _load_product_info(conn, latest_week)


def compute_core_weekly_snapshot(conn, config: Dict, report_week: dt.date, logger) -> Dict:
    dims = _load_dims(conn)
    pool_channel = dims["pool_channel"]
    pool_remark = dims["pool_remark"]
    store_channel = dims["store_channel"]
    pool_ratio = dims["pool_ratio"]

    product_map = _load_product_info(conn, report_week)
    baseline_skus = _load_previous_baseline_skus(conn, report_week)

    stock_channel_qty = defaultdict(lambda: defaultdict(float))
    stock_total_qty = defaultdict(float)
    olai_sync_qty = defaultdict(float)

    pool_available_qty = defaultdict(float)
    pool_sync_qty = defaultdict(float)

    sales_qty_by_sku = defaultdict(lambda: defaultdict(float))
    sales_amt_by_sku = defaultdict(lambda: defaultdict(float))
    tag_amt_by_sku = defaultdict(lambda: defaultdict(float))

    style_sales_amt_by_channel = defaultdict(lambda: defaultdict(float))
    style_tag_amt_by_channel = defaultdict(lambda: defaultdict(float))

    missing_store_channel = set()
    missing_pool_channel = set()
    missing_pool_ratio = set()
    unknown_inventory_channel = set()
    unknown_sales_channel = set()

    cur = conn.cursor()
    cur.execute(
        """
        SELECT MIN(settlement_date), MAX(settlement_date)
        FROM dbo.stg_sales_daily
        WHERE report_week = ?
          AND settlement_date IS NOT NULL
        """,
        (report_week,),
    )
    sales_date_row = cur.fetchone()
    sales_date_from = sales_date_row[0] if sales_date_row else None
    sales_date_to = sales_date_row[1] if sales_date_row else None

    cur.execute(
        "SELECT pool_name, sku, available_qty FROM dbo.stg_stock_daily WHERE report_week = ?",
        (report_week,),
    )
    while True:
        rows = cur.fetchmany(50000)
        if not rows:
            break
        for pool_name, sku_raw, qty_raw in rows:
            sku = normalize_code(sku_raw)
            if not sku:
                continue
            pool = normalize_text(pool_name)
            qty = to_float(qty_raw)
            stock_total_qty[sku] += qty

            channel = pool_channel.get(pool, "")
            if not channel:
                if pool:
                    missing_pool_channel.add(pool)
            elif channel in INVENTORY_CHANNELS:
                stock_channel_qty[sku][channel] += qty
            else:
                unknown_inventory_channel.add(channel)

            remark = pool_remark.get(pool, "")
            if remark == "奥莱可用":
                ratio = pool_ratio.get(pool)
                if ratio is None:
                    missing_pool_ratio.add(pool)
                else:
                    olai_sync_qty[sku] += round_half_up(qty * ratio)

    cur.execute(
        "SELECT pool_name, sku, available_qty FROM dbo.stg_pool_stock_daily WHERE report_week = ?",
        (report_week,),
    )
    while True:
        rows = cur.fetchmany(50000)
        if not rows:
            break
        for pool_name, sku_raw, qty_raw in rows:
            sku = normalize_code(sku_raw)
            if not sku:
                continue
            pool = normalize_text(pool_name)
            qty = to_float(qty_raw)
            pool_available_qty[sku] += qty
            ratio = pool_ratio.get(pool)
            if ratio is None:
                if pool:
                    missing_pool_ratio.add(pool)
                continue
            pool_sync_qty[sku] += round_half_up(qty * ratio)

    cur.execute(
        """
        SELECT store_name, sku, sales_qty, sales_amt, tag_amt
        FROM dbo.stg_sales_daily
        WHERE report_week = ?
        """,
        (report_week,),
    )
    while True:
        rows = cur.fetchmany(50000)
        if not rows:
            break
        for store_name, sku_raw, qty_raw, amt_raw, tag_raw in rows:
            sku = normalize_code(sku_raw)
            if not sku:
                continue
            store = normalize_text(store_name)
            channel = store_channel.get(store, "")
            if not channel:
                if store:
                    missing_store_channel.add(store)
                continue
            if channel not in SALES_CHANNELS:
                unknown_sales_channel.add(channel)
                continue

            qty = to_float(qty_raw)
            amt = to_float(amt_raw)
            tag_amt = to_float(tag_raw)

            sales_qty_by_sku[sku][channel] += qty
            sales_amt_by_sku[sku][channel] += amt
            tag_amt_by_sku[sku][channel] += tag_amt

            style = product_map.get(sku, {}).get("style") or _derive_style(sku)
            style_sales_amt_by_channel[style][channel] += amt
            style_tag_amt_by_channel[style][channel] += tag_amt

    threshold = to_float(config.get("rules", {}).get("new_sku_min_available_qty", 50))
    skip_tokens = [normalize_text(x).upper() for x in (config.get("rules", {}).get("skip_sku_contains") or []) if x]

    if baseline_skus:
        sku_order = list(baseline_skus)
        existed = set(sku_order)
        merged = defaultdict(float)
        for sku, qty in stock_total_qty.items():
            merged[sku] += qty
        for sku, qty in pool_available_qty.items():
            merged[sku] += qty

        for sku, qty in sorted(merged.items(), key=lambda x: x[0]):
            if sku in existed:
                continue
            if qty <= threshold:
                continue
            if any(token and token in sku for token in skip_tokens):
                continue
            sku_order.append(sku)
    else:
        sku_order = sorted(set(stock_total_qty) | set(pool_available_qty) | set(sales_qty_by_sku))

    rows_to_insert = []
    for sku in sku_order:
        info = product_map.get(sku, {})
        style = normalize_code(info.get("style") or _derive_style(sku))

        inv_values = [stock_channel_qty[sku].get(ch, 0.0) for ch in INVENTORY_CHANNELS]
        sync_qty = pool_sync_qty.get(sku, 0.0)
        exclusive_qty = sum(inv_values[:7])
        category_available = sum(inv_values[:10]) + round_half_up(sync_qty / 0.3) if sync_qty else sum(inv_values[:10])
        full_stock = stock_total_qty.get(sku, 0.0)

        sales_values = [sales_qty_by_sku[sku].get(ch, 0.0) for ch in SALES_CHANNELS]
        sales_total = sum(sales_values)
        sales_amt_total = sum(sales_amt_by_sku[sku].values())
        tag_amt_total = sum(tag_amt_by_sku[sku].values())
        sku_discount = safe_ratio(sales_amt_total, tag_amt_total)
        style_sales_total = sum(style_sales_amt_by_channel[style].values()) if style else 0.0
        style_tag_total = sum(style_tag_amt_by_channel[style].values()) if style else 0.0
        style_discount = safe_ratio(style_sales_total, style_tag_total) if style else 0.0

        sku_discount_json = json.dumps(
            {ch: safe_ratio(sales_amt_by_sku[sku].get(ch, 0.0), tag_amt_by_sku[sku].get(ch, 0.0)) for ch in SALES_CHANNELS},
            ensure_ascii=False,
            separators=(",", ":"),
        )
        style_discount_json = json.dumps(
            {
                ch: safe_ratio(
                    style_sales_amt_by_channel[style].get(ch, 0.0) if style else 0.0,
                    style_tag_amt_by_channel[style].get(ch, 0.0) if style else 0.0,
                )
                for ch in SALES_CHANNELS
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )

        inventory_json = json.dumps(
            {ch: round(stock_channel_qty[sku].get(ch, 0.0), 4) for ch in INVENTORY_CHANNELS if stock_channel_qty[sku].get(ch, 0.0) != 0},
            ensure_ascii=False,
            separators=(",", ":"),
        )
        sales_json = json.dumps(
            {ch: round(sales_qty_by_sku[sku].get(ch, 0.0), 4) for ch in SALES_CHANNELS if sales_qty_by_sku[sku].get(ch, 0.0) != 0},
            ensure_ascii=False,
            separators=(",", ":"),
        )

        rows_to_insert.append(
            (
                report_week,
                sku,
                style,
                normalize_text(info.get("major_category")),
                normalize_text(info.get("category")),
                normalize_text(info.get("product_name")),
                to_float(info.get("tag_price")),
                normalize_text(info.get("season")),
                normalize_text(info.get("gender")),
                normalize_text(info.get("story_pack")),
                normalize_text(info.get("color")),
                exclusive_qty,
                category_available,
                sync_qty,
                olai_sync_qty.get(sku, 0.0),
                full_stock,
                sales_total,
                sales_amt_total,
                tag_amt_total,
                sku_discount,
                style_discount,
                inventory_json,
                sales_json,
                sku_discount_json,
                style_discount_json,
            )
        )

    cur = conn.cursor()
    cur.execute("DELETE FROM dbo.rpt_core_weekly_snapshot WHERE report_week = ?", (report_week,))
    if rows_to_insert:
        cur.fast_executemany = True
        cur.executemany(
            """
            INSERT INTO dbo.rpt_core_weekly_snapshot(
                report_week, sku, style, major_category, category, product_name, tag_price,
                season, gender, story_pack, color,
                category_exclusive_qty, category_available_qty, pool_sync_qty, olai_sync_qty,
                full_stock_qty, ecommerce_sales_qty, sales_amt_total, tag_amt_total,
                sku_discount, style_discount, inventory_json, sales_json,
                sku_discount_json, style_discount_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows_to_insert,
        )

    cur.execute("DELETE FROM dbo.rpt_core_weekly_agg WHERE report_week = ?", (report_week,))
    cur.execute(
        """
        INSERT INTO dbo.rpt_core_weekly_agg(
            report_week, season, gender, category, style,
            sku_count, arrived_sku_count, stock_qty_total, sales_qty_total,
            sales_amt_total, tag_amt_total, discount_ratio
        )
        SELECT
            report_week,
            ISNULL(season, ''),
            ISNULL(gender, ''),
            ISNULL(category, ''),
            ISNULL(style, ''),
            COUNT(1) AS sku_count,
            SUM(CASE WHEN full_stock_qty > 0 THEN 1 ELSE 0 END) AS arrived_sku_count,
            SUM(full_stock_qty) AS stock_qty_total,
            SUM(ecommerce_sales_qty) AS sales_qty_total,
            SUM(sales_amt_total) AS sales_amt_total,
            SUM(tag_amt_total) AS tag_amt_total,
            CASE WHEN SUM(tag_amt_total) = 0 THEN 0 ELSE SUM(sales_amt_total) / SUM(tag_amt_total) END AS discount_ratio
        FROM dbo.rpt_core_weekly_snapshot
        WHERE report_week = ?
        GROUP BY report_week, ISNULL(season, ''), ISNULL(gender, ''), ISNULL(category, ''), ISNULL(style, '')
        """,
        (report_week,),
    )

    sales_period = _build_sales_period_label(sales_date_from, sales_date_to)
    stock_group_label = f"可用库存{report_week.strftime('%m%d')}"
    sales_qty_group_label = f"销售数量{sales_period}" if sales_period else "销售数量"
    sku_discount_group_label = f"销售折扣{sales_period}" if sales_period else "销售折扣"
    style_discount_group_label = f"销售折扣{sales_period}" if sales_period else "销售折扣"

    cur.execute("DELETE FROM dbo.rpt_core_weekly_meta WHERE report_week = ?", (report_week,))
    cur.execute(
        """
        INSERT INTO dbo.rpt_core_weekly_meta(
            report_week,
            stock_group_label, sales_qty_group_label, sku_discount_group_label, style_discount_group_label,
            sales_date_from, sales_date_to, row_count,
            missing_store_channel_count, missing_pool_channel_count, missing_pool_ratio_count,
            unknown_inventory_channel_count, unknown_sales_channel_count
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            report_week,
            stock_group_label,
            sales_qty_group_label,
            sku_discount_group_label,
            style_discount_group_label,
            sales_date_from,
            sales_date_to,
            len(rows_to_insert),
            len(missing_store_channel),
            len(missing_pool_channel),
            len(missing_pool_ratio),
            len(unknown_inventory_channel),
            len(unknown_sales_channel),
        ),
    )

    conn.commit()

    cur.execute(
        """
        SELECT
            COUNT(1) AS total_sku,
            COUNT(DISTINCT ISNULL(style, '')) AS total_style,
            SUM(CASE WHEN full_stock_qty > 0 THEN 1 ELSE 0 END) AS arrived_sku,
            SUM(full_stock_qty) AS stock_qty_total,
            SUM(ecommerce_sales_qty) AS sales_qty_total,
            SUM(sales_amt_total) AS sales_amt_total,
            SUM(tag_amt_total) AS tag_amt_total
        FROM dbo.rpt_core_weekly_snapshot
        WHERE report_week = ?
        """,
        (report_week,),
    )
    total_row = cur.fetchone()

    total_sku = int(total_row[0] or 0)
    total_style = int(total_row[1] or 0)
    arrived_sku = int(total_row[2] or 0)
    stock_qty_total = float(total_row[3] or 0)
    sales_qty_total = float(total_row[4] or 0)
    sales_amt_total = float(total_row[5] or 0)
    tag_amt_total = float(total_row[6] or 0)

    summary = {
        "report_week": report_week.isoformat(),
        "total_sku": total_sku,
        "total_style": total_style,
        "arrived_sku": arrived_sku,
        "arrival_rate": round((arrived_sku / total_sku), 6) if total_sku else 0.0,
        "stock_qty_total": round(stock_qty_total, 4),
        "sales_qty_total": round(sales_qty_total, 4),
        "sales_amt_total": round(sales_amt_total, 4),
        "tag_amt_total": round(tag_amt_total, 4),
        "discount_ratio": safe_ratio(sales_amt_total, tag_amt_total),
        "missing_store_channel": len(missing_store_channel),
        "missing_pool_channel": len(missing_pool_channel),
        "missing_pool_ratio": len(missing_pool_ratio),
        "unknown_inventory_channel": len(unknown_inventory_channel),
        "unknown_sales_channel": len(unknown_sales_channel),
        "meta": {
            "stock_group_label": stock_group_label,
            "sales_qty_group_label": sales_qty_group_label,
            "sku_discount_group_label": sku_discount_group_label,
            "style_discount_group_label": style_discount_group_label,
            "sales_date_from": sales_date_from.isoformat() if sales_date_from else "",
            "sales_date_to": sales_date_to.isoformat() if sales_date_to else "",
            "row_count": len(rows_to_insert),
        },
    }
    logger.info("compute", "weekly snapshot built", summary)
    return summary


def compute_core_daily_snapshot(conn, config: Dict, sales_date: dt.date, inventory_date: dt.date, logger) -> Dict:
    dims = _load_dims(conn)
    pool_channel = dims["pool_channel"]
    pool_remark = dims["pool_remark"]
    store_channel = dims["store_channel"]
    pool_ratio = dims["pool_ratio"]

    product_map = _load_product_info_for_daily(conn, inventory_date)

    stock_channel_qty = defaultdict(lambda: defaultdict(float))
    stock_total_qty = defaultdict(float)
    pool_available_qty = defaultdict(float)
    pool_sync_qty = defaultdict(float)
    olai_sync_qty = defaultdict(float)

    sales_qty_by_sku = defaultdict(lambda: defaultdict(float))
    sales_amt_by_sku = defaultdict(lambda: defaultdict(float))
    tag_amt_by_sku = defaultdict(lambda: defaultdict(float))

    style_sales_amt_by_channel = defaultdict(lambda: defaultdict(float))
    style_tag_amt_by_channel = defaultdict(lambda: defaultdict(float))

    missing_store_channel = set()
    missing_pool_channel = set()
    missing_pool_ratio = set()
    unknown_inventory_channel = set()
    unknown_sales_channel = set()

    cur = conn.cursor()
    cur.execute(
        """
        SELECT pool_name, sku, available_qty
        FROM dbo.stg_inventory_latest
        WHERE inventory_date = ?
        """,
        (inventory_date,),
    )
    while True:
        rows = cur.fetchmany(50000)
        if not rows:
            break
        for pool_name, sku_raw, qty_raw in rows:
            sku = normalize_code(sku_raw)
            if not sku:
                continue
            pool = normalize_text(pool_name)
            qty = to_float(qty_raw)
            stock_total_qty[sku] += qty

            channel = pool_channel.get(pool, "")
            if not channel:
                if pool:
                    missing_pool_channel.add(pool)
            elif channel in INVENTORY_CHANNELS:
                stock_channel_qty[sku][channel] += qty
            else:
                unknown_inventory_channel.add(channel)

            ratio = pool_ratio.get(pool)
            if ratio is None:
                if pool:
                    missing_pool_ratio.add(pool)
            else:
                pool_sync_qty[sku] += round_half_up(qty * ratio)

            remark = pool_remark.get(pool, "")
            if remark == "奥莱可用":
                if ratio is None:
                    if pool:
                        missing_pool_ratio.add(pool)
                else:
                    olai_sync_qty[sku] += round_half_up(qty * ratio)

    cur.execute(
        """
        SELECT pool_name, sku, available_qty
        FROM dbo.stg_pool_stock_daily
        WHERE report_week = ?
        """,
        (inventory_date,),
    )
    while True:
        rows = cur.fetchmany(50000)
        if not rows:
            break
        for pool_name, sku_raw, qty_raw in rows:
            sku = normalize_code(sku_raw)
            if not sku:
                continue
            pool = normalize_text(pool_name)
            qty = to_float(qty_raw)
            pool_available_qty[sku] += qty
            ratio = pool_ratio.get(pool)
            if ratio is None:
                if pool:
                    missing_pool_ratio.add(pool)
                continue
            pool_sync_qty[sku] += round_half_up(qty * ratio)

    cur.execute(
        """
        SELECT store_name, sku, sales_qty, sales_amt, tag_amt
        FROM dbo.stg_sales_day
        WHERE sales_date = ?
        """,
        (sales_date,),
    )
    while True:
        rows = cur.fetchmany(50000)
        if not rows:
            break
        for store_name, sku_raw, qty_raw, amt_raw, tag_raw in rows:
            sku = normalize_code(sku_raw)
            if not sku:
                continue
            store = normalize_text(store_name)
            channel = store_channel.get(store, "")
            if not channel:
                if store:
                    missing_store_channel.add(store)
                continue
            if channel not in SALES_CHANNELS:
                unknown_sales_channel.add(channel)
                continue

            qty = to_float(qty_raw)
            amt = to_float(amt_raw)
            tag_amt = to_float(tag_raw)

            sales_qty_by_sku[sku][channel] += qty
            sales_amt_by_sku[sku][channel] += amt
            tag_amt_by_sku[sku][channel] += tag_amt

            style = product_map.get(sku, {}).get("style") or _derive_style(sku)
            style_sales_amt_by_channel[style][channel] += amt
            style_tag_amt_by_channel[style][channel] += tag_amt

    sku_order = sorted(set(stock_total_qty) | set(pool_available_qty) | set(sales_qty_by_sku))

    rows_to_insert = []
    for sku in sku_order:
        info = product_map.get(sku, {})
        style = normalize_code(info.get("style") or _derive_style(sku))

        inv_values = [stock_channel_qty[sku].get(ch, 0.0) for ch in INVENTORY_CHANNELS]
        sync_qty = pool_sync_qty.get(sku, 0.0)
        exclusive_qty = sum(inv_values[:7])
        category_available = sum(inv_values[:10]) + round_half_up(sync_qty / 0.3) if sync_qty else sum(inv_values[:10])
        full_stock = stock_total_qty.get(sku, 0.0)

        sales_values = [sales_qty_by_sku[sku].get(ch, 0.0) for ch in SALES_CHANNELS]
        sales_total = sum(sales_values)
        sales_amt_total = sum(sales_amt_by_sku[sku].values())
        tag_amt_total = sum(tag_amt_by_sku[sku].values())
        sku_discount = safe_ratio(sales_amt_total, tag_amt_total)
        style_sales_total = sum(style_sales_amt_by_channel[style].values()) if style else 0.0
        style_tag_total = sum(style_tag_amt_by_channel[style].values()) if style else 0.0
        style_discount = safe_ratio(style_sales_total, style_tag_total) if style else 0.0

        sku_discount_json = json.dumps(
            {ch: safe_ratio(sales_amt_by_sku[sku].get(ch, 0.0), tag_amt_by_sku[sku].get(ch, 0.0)) for ch in SALES_CHANNELS},
            ensure_ascii=False,
            separators=(",", ":"),
        )
        style_discount_json = json.dumps(
            {
                ch: safe_ratio(
                    style_sales_amt_by_channel[style].get(ch, 0.0) if style else 0.0,
                    style_tag_amt_by_channel[style].get(ch, 0.0) if style else 0.0,
                )
                for ch in SALES_CHANNELS
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )

        inventory_json = json.dumps(
            {ch: round(stock_channel_qty[sku].get(ch, 0.0), 4) for ch in INVENTORY_CHANNELS if stock_channel_qty[sku].get(ch, 0.0) != 0},
            ensure_ascii=False,
            separators=(",", ":"),
        )
        sales_json = json.dumps(
            {ch: round(sales_qty_by_sku[sku].get(ch, 0.0), 4) for ch in SALES_CHANNELS if sales_qty_by_sku[sku].get(ch, 0.0) != 0},
            ensure_ascii=False,
            separators=(",", ":"),
        )

        rows_to_insert.append(
            (
                sales_date,
                sku,
                inventory_date,
                style,
                normalize_text(info.get("major_category")),
                normalize_text(info.get("category")),
                normalize_text(info.get("product_name")),
                to_float(info.get("tag_price")),
                normalize_text(info.get("season")),
                normalize_text(info.get("gender")),
                normalize_text(info.get("story_pack")),
                normalize_text(info.get("color")),
                exclusive_qty,
                category_available,
                sync_qty,
                olai_sync_qty.get(sku, 0.0),
                full_stock,
                sales_total,
                sales_amt_total,
                tag_amt_total,
                sku_discount,
                style_discount,
                inventory_json,
                sales_json,
                sku_discount_json,
                style_discount_json,
                0.0,
                0.0,
                0.0,
                0.0,
            )
        )

    cur = conn.cursor()
    cur.execute("DELETE FROM dbo.rpt_daily_sku_wide_hot WHERE sales_date = ?", (sales_date,))
    if rows_to_insert:
        cur.fast_executemany = True
        cur.executemany(
            """
            INSERT INTO dbo.rpt_daily_sku_wide_hot(
                sales_date, sku, inventory_date, style, major_category, category, product_name, tag_price,
                season, gender, story_pack, color,
                category_exclusive_qty, category_available_qty, pool_sync_qty, olai_sync_qty,
                full_stock_qty, ecommerce_sales_qty, sales_amt_total, tag_amt_total,
                sku_discount, style_discount, inventory_json, sales_json,
                sku_discount_json, style_discount_json, promo_impressions, promo_clicks, promo_spend, promo_gmv
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows_to_insert,
        )

    sales_period = _format_month_day(sales_date)
    stock_group_label = f"可用库存{inventory_date.strftime('%m%d')}"
    sales_qty_group_label = f"销售数量{sales_period}" if sales_period else "销售数量"
    sku_discount_group_label = f"销售折扣{sales_period}" if sales_period else "销售折扣"
    style_discount_group_label = f"销售折扣{sales_period}" if sales_period else "销售折扣"

    cur.execute("DELETE FROM dbo.rpt_daily_meta WHERE sales_date = ?", (sales_date,))
    cur.execute(
        """
        INSERT INTO dbo.rpt_daily_meta(
            sales_date, inventory_date,
            stock_group_label, sales_qty_group_label, sku_discount_group_label, style_discount_group_label,
            row_count,
            missing_store_channel_count, missing_pool_channel_count, missing_pool_ratio_count,
            unknown_inventory_channel_count, unknown_sales_channel_count
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            sales_date,
            inventory_date,
            stock_group_label,
            sales_qty_group_label,
            sku_discount_group_label,
            style_discount_group_label,
            len(rows_to_insert),
            len(missing_store_channel),
            len(missing_pool_channel),
            len(missing_pool_ratio),
            len(unknown_inventory_channel),
            len(unknown_sales_channel),
        ),
    )
    conn.commit()

    cur.execute(
        """
        SELECT
            COUNT(1) AS total_sku,
            COUNT(DISTINCT ISNULL(style, '')) AS total_style,
            SUM(CASE WHEN full_stock_qty > 0 THEN 1 ELSE 0 END) AS arrived_sku,
            SUM(full_stock_qty) AS stock_qty_total,
            SUM(ecommerce_sales_qty) AS sales_qty_total,
            SUM(sales_amt_total) AS sales_amt_total,
            SUM(tag_amt_total) AS tag_amt_total
        FROM dbo.rpt_daily_sku_wide_hot
        WHERE sales_date = ?
        """,
        (sales_date,),
    )
    total_row = cur.fetchone()

    total_sku = int(total_row[0] or 0)
    total_style = int(total_row[1] or 0)
    arrived_sku = int(total_row[2] or 0)
    stock_qty_total = float(total_row[3] or 0)
    sales_qty_total = float(total_row[4] or 0)
    sales_amt_total = float(total_row[5] or 0)
    tag_amt_total = float(total_row[6] or 0)

    summary = {
        "sales_date": sales_date.isoformat(),
        "inventory_date": inventory_date.isoformat(),
        "total_sku": total_sku,
        "total_style": total_style,
        "arrived_sku": arrived_sku,
        "arrival_rate": round((arrived_sku / total_sku), 6) if total_sku else 0.0,
        "stock_qty_total": round(stock_qty_total, 4),
        "sales_qty_total": round(sales_qty_total, 4),
        "sales_amt_total": round(sales_amt_total, 4),
        "tag_amt_total": round(tag_amt_total, 4),
        "discount_ratio": safe_ratio(sales_amt_total, tag_amt_total),
        "missing_store_channel": len(missing_store_channel),
        "missing_pool_channel": len(missing_pool_channel),
        "missing_pool_ratio": len(missing_pool_ratio),
        "unknown_inventory_channel": len(unknown_inventory_channel),
        "unknown_sales_channel": len(unknown_sales_channel),
        "meta": {
            "stock_group_label": stock_group_label,
            "sales_qty_group_label": sales_qty_group_label,
            "sku_discount_group_label": sku_discount_group_label,
            "style_discount_group_label": style_discount_group_label,
            "row_count": len(rows_to_insert),
        },
    }
    logger.info("compute_daily", "daily snapshot built", summary)
    return summary


def archive_daily_snapshot(conn, keep_months: int = 12, logger=None) -> Dict:
    safe_months = max(1, int(keep_months or 12))
    cols = ", ".join(DAILY_WIDE_COLUMNS)
    cur = conn.cursor()

    cur.execute("SELECT COUNT(1) FROM dbo.rpt_daily_sku_wide_archive")
    before_archive_count = int(cur.fetchone()[0] or 0)

    cur.execute(
        f"""
        INSERT INTO dbo.rpt_daily_sku_wide_archive({cols})
        SELECT {cols}
        FROM dbo.rpt_daily_sku_wide_hot h
        WHERE h.sales_date < DATEADD(MONTH, ?, CAST(GETDATE() AS DATE))
          AND NOT EXISTS (
              SELECT 1
              FROM dbo.rpt_daily_sku_wide_archive a
              WHERE a.sales_date = h.sales_date
                AND a.sku = h.sku
          )
        """,
        (-safe_months,),
    )

    cur.execute("SELECT COUNT(1) FROM dbo.rpt_daily_sku_wide_archive")
    after_archive_count = int(cur.fetchone()[0] or 0)
    inserted_count = max(0, after_archive_count - before_archive_count)

    cur.execute(
        """
        DELETE FROM dbo.rpt_daily_sku_wide_hot
        WHERE sales_date < DATEADD(MONTH, ?, CAST(GETDATE() AS DATE))
        """,
        (-safe_months,),
    )
    deleted_count = int(cur.rowcount if cur.rowcount is not None and cur.rowcount >= 0 else 0)

    conn.commit()
    result = {
        "keep_months": safe_months,
        "moved_rows": inserted_count,
        "deleted_from_hot": deleted_count,
    }
    if logger is not None:
        logger.info("archive_daily", "daily hot rows archived", result)
    return result


def build_dashboard_payload(conn, window_weeks: int = 52, mapping_gaps: Dict | None = None) -> Dict:
    cur = conn.cursor()
    cur.execute("SELECT MAX(report_week) FROM dbo.rpt_core_weekly_snapshot")
    row = cur.fetchone()
    latest_week = row[0] if row else None

    if latest_week is None:
        return {
            "summary": {},
            "history": {"window_weeks": window_weeks, "weeks": [], "series": []},
            "latest": {"report_week": "", "records": [], "agg_rows": []},
            "status": {"mapping_gaps": mapping_gaps or {}},
            "generated_at": dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }

    n = max(1, int(window_weeks or 52))
    cur.execute(
        f"""
        WITH weeks AS (
            SELECT TOP ({n}) report_week
            FROM dbo.rpt_core_weekly_snapshot
            GROUP BY report_week
            ORDER BY report_week DESC
        )
        SELECT
            s.report_week,
            COUNT(1) AS total_sku,
            COUNT(DISTINCT ISNULL(s.style, '')) AS total_style,
            SUM(CASE WHEN s.full_stock_qty > 0 THEN 1 ELSE 0 END) AS arrived_sku,
            SUM(s.full_stock_qty) AS stock_qty_total,
            SUM(s.ecommerce_sales_qty) AS sales_qty_total,
            SUM(s.sales_amt_total) AS sales_amt_total,
            SUM(s.tag_amt_total) AS tag_amt_total
        FROM dbo.rpt_core_weekly_snapshot s
        INNER JOIN weeks w ON s.report_week = w.report_week
        GROUP BY s.report_week
        ORDER BY s.report_week
        """
    )

    series = []
    weeks = []
    for r in cur.fetchall():
        week_iso = r[0].isoformat()
        total_sku = int(r[1] or 0)
        arrived_sku = int(r[3] or 0)
        sales_amt_total = float(r[6] or 0)
        tag_amt_total = float(r[7] or 0)
        item = {
            "report_week": week_iso,
            "total_sku": total_sku,
            "total_style": int(r[2] or 0),
            "arrived_sku": arrived_sku,
            "arrival_rate": round((arrived_sku / total_sku), 6) if total_sku else 0.0,
            "stock_qty_total": round(float(r[4] or 0), 4),
            "sales_qty_total": round(float(r[5] or 0), 4),
            "sales_amt_total": round(sales_amt_total, 4),
            "tag_amt_total": round(tag_amt_total, 4),
            "discount_ratio": safe_ratio(sales_amt_total, tag_amt_total),
        }
        series.append(item)
        weeks.append(week_iso)

    summary = dict(series[-1]) if series else {}

    cur.execute(
        """
        SELECT
            sku, style, major_category, category, product_name, tag_price,
            season, gender, story_pack, color,
            category_exclusive_qty, category_available_qty,
            pool_sync_qty, olai_sync_qty, full_stock_qty, ecommerce_sales_qty,
            sales_amt_total, tag_amt_total, sku_discount, style_discount,
            inventory_json, sales_json
        FROM dbo.rpt_core_weekly_snapshot
        WHERE report_week = ?
        ORDER BY sku
        """,
        (latest_week,),
    )
    latest_records = []
    for r in cur.fetchall():
        latest_records.append(
            {
                "sku": normalize_text(r[0]),
                "style": normalize_text(r[1]),
                "major_category": normalize_text(r[2]),
                "category": normalize_text(r[3]),
                "product_name": normalize_text(r[4]),
                "tag_price": to_float(r[5]),
                "season": normalize_text(r[6]),
                "gender": normalize_text(r[7]),
                "story_pack": normalize_text(r[8]),
                "color": normalize_text(r[9]),
                "category_exclusive_qty": to_float(r[10]),
                "category_available_qty": to_float(r[11]),
                "pool_sync_qty": to_float(r[12]),
                "olai_sync_qty": to_float(r[13]),
                "full_stock_qty": to_float(r[14]),
                "ecommerce_sales_qty": to_float(r[15]),
                "sales_amt_total": to_float(r[16]),
                "tag_amt_total": to_float(r[17]),
                "sku_discount": to_float(r[18]),
                "style_discount": to_float(r[19]),
                "inventory": json.loads(r[20]) if r[20] else {},
                "sales": json.loads(r[21]) if r[21] else {},
            }
        )

    cur.execute(
        """
        SELECT season, gender, category, style, sku_count, arrived_sku_count,
               stock_qty_total, sales_qty_total, sales_amt_total, tag_amt_total, discount_ratio
        FROM dbo.rpt_core_weekly_agg
        WHERE report_week = ?
        ORDER BY season, gender, category, style
        """,
        (latest_week,),
    )
    agg_rows = []
    for r in cur.fetchall():
        agg_rows.append(
            {
                "season": normalize_text(r[0]),
                "gender": normalize_text(r[1]),
                "category": normalize_text(r[2]),
                "style": normalize_text(r[3]),
                "sku_count": int(r[4] or 0),
                "arrived_sku_count": int(r[5] or 0),
                "stock_qty_total": to_float(r[6]),
                "sales_qty_total": to_float(r[7]),
                "sales_amt_total": to_float(r[8]),
                "tag_amt_total": to_float(r[9]),
                "discount_ratio": to_float(r[10]),
            }
        )

    return {
        "summary": summary,
        "history": {
            "window_weeks": n,
            "weeks": weeks,
            "series": series,
        },
        "latest": {
            "report_week": latest_week.isoformat(),
            "records": latest_records,
            "agg_rows": agg_rows,
        },
        "status": {
            "mapping_gaps": mapping_gaps or {},
        },
        "generated_at": dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
