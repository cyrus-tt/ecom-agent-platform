import { Card } from "antd";

/**
 * `<Card className="hero-card" size="small" />` 的简化包装。
 * 业务上对应每个 page 顶部那块"标题 + 描述"卡片。
 */
export default function HeroCard({ children, className = "", bodyStyle, ...rest }) {
  const merged = ["hero-card", className].filter(Boolean).join(" ");
  return (
    <Card className={merged} size="small" bodyStyle={bodyStyle} {...rest}>
      {children}
    </Card>
  );
}
