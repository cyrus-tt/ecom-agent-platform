import { Empty, Popover, Spin, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";

const { Text } = Typography;

function SkuPreviewContent({ sku, imageBasePath }) {
  const [status, setStatus] = useState("loading");
  const imageUrl = useMemo(
    () => `${String(imageBasePath || "/api/image").replace(/\/+$/, "")}/${encodeURIComponent(sku)}`,
    [imageBasePath, sku]
  );

  useEffect(() => {
    setStatus("loading");
  }, [imageUrl]);

  return (
    <div className="sku-preview-card">
      <Text className="sku-preview-title">货号：{sku}</Text>
      <div className="sku-preview-image-shell">
        {status === "loading" ? (
          <div className="sku-preview-loading">
            <Spin size="small" />
          </div>
        ) : null}
        {status === "error" ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无图片" />
        ) : (
          <img
            src={imageUrl}
            alt={sku}
            className={`sku-preview-image ${status === "ready" ? "is-ready" : ""}`}
            onLoad={() => setStatus("ready")}
            onError={() => setStatus("error")}
          />
        )}
      </div>
    </div>
  );
}

export default function SkuPreview({
  sku,
  text,
  className = "",
  style,
  placement = "right",
  imageBasePath = "/api/image",
}) {
  const safeSku = String(sku || "").trim();
  const displayText = String(text ?? safeSku).trim() || "-";

  if (!safeSku) {
    return <span style={style}>{displayText}</span>;
  }

  return (
    <Popover
      placement={placement}
      trigger="hover"
      mouseEnterDelay={0.15}
      overlayClassName="sku-preview-overlay"
      content={<SkuPreviewContent sku={safeSku} imageBasePath={imageBasePath} />}
    >
      <span className={`sku-preview-trigger ${className}`.trim()} style={style}>
        {displayText}
      </span>
    </Popover>
  );
}
