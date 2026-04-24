from __future__ import annotations

import json
from pathlib import Path
from typing import Dict

from .common import resolve_path


def _safe_json(payload: Dict) -> str:
    text = json.dumps(payload, ensure_ascii=False)
    return text.replace("</", "<\\/")


def build_static_dashboard(config: Dict, payload: Dict, logger) -> str:
    base_dir = config.get("_base_dir")
    web_dir = resolve_path(config.get("paths", {}).get("web_dir", "web"), base_dir)
    output_path = resolve_path(config.get("paths", {}).get("snapshot_path", "dashboard.html"), base_dir)

    index_path = Path(web_dir) / "index.html"
    css_path = Path(web_dir) / "styles.css"
    js_path = Path(web_dir) / "app.js"

    if not index_path.exists() or not css_path.exists() or not js_path.exists():
        raise FileNotFoundError(f"web assets missing under: {web_dir}")

    html = index_path.read_text(encoding="utf-8")
    css = css_path.read_text(encoding="utf-8")
    app_js = js_path.read_text(encoding="utf-8")

    data_script = (
        "<script>"
        "window.__DASHBOARD_STATIC__=true;"
        f"window.__DASHBOARD_DATA__={_safe_json(payload)};"
        "</script>"
    )
    app_script = f"<script>\n{app_js}\n</script>"

    if '<link rel="stylesheet" href="./styles.css">' in html:
        html = html.replace('<link rel="stylesheet" href="./styles.css">', f"<style>\n{css}\n</style>", 1)
    elif "</head>" in html:
        html = html.replace("</head>", f"<style>\n{css}\n</style>\n</head>", 1)

    if '<script src="./app.js"></script>' in html:
        html = html.replace('<script src="./app.js"></script>', data_script + "\n" + app_script, 1)
    elif "</body>" in html:
        html = html.replace("</body>", data_script + "\n" + app_script + "\n</body>", 1)

    Path(output_path).write_text(html, encoding="utf-8")
    logger.info("snapshot", "dashboard html built", {"path": output_path})
    return output_path
