"use strict";

const z = require("zod");

const ColumnSchema = z.object({
  type: z.enum(["text", "integer", "numeric", "date", "boolean"]),
  description: z.string(),
});

const TableSchema = z.object({
  description: z.string(),
  schema: z.string(),
  primary_key: z.array(z.string()),
  columns: z.record(z.string(), ColumnSchema),
});

const ChannelSchema = z.object({
  code: z.string(),
  label: z.string(),
  sales_qty_col: z.string(),
  inventory_qty_col: z.string().nullable(),
  sku_discount_col: z.string(),
  style_discount_col: z.string(),
  include_category_shared: z.boolean(),
});

const MetricSchema = z.object({
  label: z.string(),
  description: z.string(),
  unit: z.string(),
  agg: z.enum(["sum", "avg", "count_distinct"]).optional(),
  sql_channel: z.string().optional(),
  sql_total: z.string().optional(),
  table: z.string().optional(),
  derived: z.boolean().optional(),
  formula: z.string().optional(),
});

const DimensionSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
  column: z.string().optional(),
  coalesce: z.string().optional(),
  type: z.enum(["enum", "date", "text"]).optional(),
  granularity: z.array(z.string()).optional(),
  values_ref: z.string().optional(),
  table: z.union([z.string(), z.array(z.string())]).optional(),
});

const RelationshipSchema = z.object({
  from: z.string(),
  to: z.string(),
  join: z.string(),
  type: z.enum(["one_to_one", "one_to_many", "many_to_one"]),
  description: z.string().optional(),
});

const GlobalFilterSchema = z.object({
  description: z.string(),
  sql: z.string(),
  always_apply: z.boolean().default(false),
});

const AgeBucket = z.object({
  range: z.string(),
  severity: z.enum(["info", "warning", "critical"]),
});

const DetectionRuleSchema = z.object({
  label: z.string(),
  description: z.string(),
  warn_threshold: z.number().optional(),
  crit_threshold: z.number().optional(),
  min_count: z.number().optional(),
  severity: z.enum(["info", "warning", "critical"]).optional(),
  age_buckets: z.array(AgeBucket).optional(),
  unit: z.string().optional(),
  lookback_days: z.number(),
});

const ExampleSchema = z.object({
  question: z.string(),
  sql: z.string(),
  explanation: z.string(),
});

const SemanticConfigSchema = z.object({
  version: z.string(),
  schema_name: z.string(),
  tables: z.record(z.string(), TableSchema),
  channels: z.array(ChannelSchema).min(1),
  metrics: z.record(z.string(), MetricSchema),
  dimensions: z.record(z.string(), DimensionSchema),
  relationships: z.array(RelationshipSchema),
  global_filters: z.record(z.string(), GlobalFilterSchema),
  detection_rules: z.record(z.string(), DetectionRuleSchema),
  examples: z.array(ExampleSchema).min(1),
});

module.exports = { SemanticConfigSchema, ChannelSchema, MetricSchema };
