import { Space, Tag, Typography } from "antd";

const { Title, Text } = Typography;

/**
 * 统一 page 顶部的 hero 区：标题 + 描述 + 右侧 actions + tags。
 *
 * @param {{
 *   title: import("react").ReactNode,
 *   description?: import("react").ReactNode,
 *   tags?: Array<{ key?: string, color?: string, label: import("react").ReactNode }>,
 *   actions?: import("react").ReactNode,
 *   level?: 1|2|3|4|5,
 * }} props
 */
export default function PageHeader({ title, description, tags, actions, level = 3 }) {
  const tagList = Array.isArray(tags) ? tags.filter(Boolean) : [];
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        <Title level={level} style={{ margin: 0 }}>
          {title}
        </Title>
        {description ? <Text type="secondary">{description}</Text> : null}
        {tagList.length ? (
          <Space size={6} wrap>
            {tagList.map((tag, idx) => (
              <Tag key={tag.key ?? idx} color={tag.color}>
                {tag.label}
              </Tag>
            ))}
          </Space>
        ) : null}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </div>
  );
}
