"use strict";

const { getPool, timedQuery } = require("../../lib/db");
const { REPORT_CACHE_TTL_MS } = require("./cache");
const { normalizeDailyRangeInput, normalizeDateInput, toDateText, dateTimeText } = require("./shared/dateUtils");
const { filterObjectRowsByKeyword, paginateRows } = require("./shared/pagination");
const { toText, toNumber, toIntValue, toPercentText } = require("./shared/numberUtils");

const OUTLET_ASSORTMENT_CACHE = new Map();

const REPORT_SKU_FILTER_SQL = "coalesce(sku, '') not ilike '%u%' and coalesce(sku, '') not ilike '%v%'";

const OUTLET_ASSORTMENT_COLUMNS = [
  { key: "season", header: "产品季", type: "text", width: 10 },
  { key: "style", header: "款", type: "text", width: 14 },
  { key: "sku", header: "货号", type: "text", width: 16 },
  { key: "major_category", header: "商品大类", type: "text", width: 12 },
  { key: "category", header: "中类", type: "text", width: 16 },
  { key: "product_name", header: "品名", type: "text", width: 18 },
  { key: "gender", header: "性别", type: "text", width: 8 },
  { key: "tag_price", header: "吊牌价", type: "number", width: 10 },
  { key: "story_pack", header: "故事包", type: "text", width: 14 },
  { key: "listing_outlet", header: "奥莱", type: "text", width: 10 },
  { key: "listing_c_store", header: "C店", type: "text", width: 10 },
  { key: "remark", header: "备注", type: "text", width: 16 },
  { key: "enter_xiaodengta", header: "是否进小灯塔", type: "text", width: 14 },
  { key: "outlet_available_qty", header: "奥莱可用", type: "number", width: 12 },
  { key: "inv_huotong_qty", header: "货通", type: "number", width: 10 },
  { key: "inv_outlet_exclusive_qty", header: "奥莱独享", type: "number", width: 12 },
  { key: "inv_c_store_exclusive_qty", header: "C店独享", type: "number", width: 12 },
  { key: "inv_outlets_presale_qty", header: "正价奥莱共享", type: "number", width: 16 },
  { key: "inv_ecommerce_warehouse_qty", header: "电商总仓", type: "number", width: 12 },
  { key: "inv_bulk_shared_qty", header: "大货共享", type: "number", width: 12 },
  { key: "inv_bulk_new_shared_qty", header: "安踏大货新品共享仓", type: "number", width: 20 },
  { key: "inv_traditional_shared_qty", header: "传统共享", type: "number", width: 12 },
  { key: "inv_tmall_shared_qty", header: "天猫共享", type: "number", width: 12 },
  { key: "inv_category_flagship_shared_qty", header: "品类共享", type: "number", width: 12 },
  { key: "inv_online_shared_platform_qty", header: "大货线上共享平台", type: "number", width: 18 },
  { key: "inv_interest_degrade_shared_qty", header: "兴趣降解共享仓", type: "number", width: 18 },
  { key: "inv_doudp_shared_qty", header: "抖得拼共享仓", type: "number", width: 16 },
  { key: "inv_bulk_degrade_exclusive_qty", header: "大货降解独享仓", type: "number", width: 18 },
  { key: "inv_jitx_qty", header: "JITX虚仓", type: "number", width: 12 },
  { key: "inv_pdd_jitx2_qty", header: "拼多多虚仓-JITX2", type: "number", width: 18 },
  { key: "inventory_total_qty", header: "总计", type: "number", width: 12 },
  { key: "sales_outlet_qty", header: "奥莱", type: "number", width: 10 },
  { key: "sales_outlet_anjianli_qty", header: "奥莱安建立", type: "number", width: 14 },
  { key: "sales_c_store_qty", header: "C店", type: "number", width: 10 },
  { key: "sales_vip_qty", header: "唯品", type: "number", width: 10 },
  { key: "sales_pdd_qty", header: "拼多多", type: "number", width: 10 },
  { key: "sales_shanghai_qty", header: "上海", type: "number", width: 10 },
  { key: "sales_tmall_flagship_qty", header: "天旗", type: "number", width: 10 },
  { key: "sales_tmall_franchise_qty", header: "天猫专卖", type: "number", width: 12 },
  { key: "sales_other_qty", header: "其他", type: "number", width: 10 },
  { key: "sales_jd_qty", header: "京东", type: "number", width: 10 },
  { key: "sales_interest_qty", header: "兴趣", type: "number", width: 10 },
  { key: "sales_trend_qty", header: "潮流", type: "number", width: 10 },
  { key: "sales_outdoor_qty", header: "户外", type: "number", width: 10 },
  { key: "sales_women_qty", header: "女子", type: "number", width: 10 },
  { key: "sales_casual_qty", header: "休闲", type: "number", width: 10 },
  { key: "sales_dewu_qty", header: "得物", type: "number", width: 10 },
  { key: "sales_distributor_qty", header: "经销", type: "number", width: 10 },
  { key: "sales_group_buy_qty", header: "团购", type: "number", width: 10 },
  { key: "sales_total_qty", header: "总计", type: "number", width: 12 },
  { key: "discount_outlet", header: "奥莱", type: "percent", width: 10 },
  { key: "discount_outlet_anjianli", header: "奥莱安建立", type: "percent", width: 14 },
  { key: "discount_c_store", header: "C店", type: "percent", width: 10 },
  { key: "discount_vip", header: "唯品", type: "percent", width: 10 },
  { key: "discount_pdd", header: "拼多多", type: "percent", width: 10 },
  { key: "discount_shanghai", header: "上海", type: "percent", width: 10 },
  { key: "discount_tmall_flagship", header: "天旗", type: "percent", width: 10 },
  { key: "discount_tmall_franchise", header: "天猫专卖", type: "percent", width: 12 },
  { key: "discount_other", header: "其他", type: "percent", width: 10 },
  { key: "discount_jd", header: "京东", type: "percent", width: 10 },
  { key: "discount_interest", header: "兴趣", type: "percent", width: 10 },
  { key: "discount_trend", header: "潮流", type: "percent", width: 10 },
  { key: "discount_outdoor", header: "户外", type: "percent", width: 10 },
  { key: "discount_women", header: "女子", type: "percent", width: 10 },
  { key: "discount_casual", header: "休闲", type: "percent", width: 10 },
  { key: "discount_dewu", header: "得物", type: "percent", width: 10 },
  { key: "discount_distributor", header: "经销", type: "percent", width: 10 },
  { key: "discount_total", header: "总计", type: "percent", width: 12 },
];

const NUMERIC_KEYS = new Set(
  OUTLET_ASSORTMENT_COLUMNS.filter((column) => column.type === "number").map((column) => column.key)
);
const PERCENT_KEYS = new Set(
  OUTLET_ASSORTMENT_COLUMNS.filter((column) => column.type === "percent").map((column) => column.key)
);
const TEXT_KEYS = new Set(
  OUTLET_ASSORTMENT_COLUMNS.filter((column) => column.type === "text").map((column) => column.key)
);

const OUTLET_ASSORTMENT_SQL = `
with date_params as (
    select $1::date as date_from, $2::date as date_to
),
latest_inventory_date as (
    select max(snapshot_date) as snapshot_date
    from anta_daily.src_inventory_current
),
product_dim as (
    select distinct on (btrim(sku))
        btrim(sku) as sku,
        nullif(btrim(style), '') as style,
        nullif(btrim(major_category), '') as major_category,
        nullif(btrim(category), '') as category,
        nullif(btrim(product_name), '') as product_name,
        tag_price,
        nullif(btrim(season), '') as season,
        nullif(btrim(gender), '') as gender,
        nullif(btrim(story_pack), '') as story_pack
    from anta_daily.src_product_master_current
    where nullif(btrim(sku), '') is not null
      and ${REPORT_SKU_FILTER_SQL}
    order by btrim(sku), source_file desc, loaded_at desc
),
inventory_raw as (
    select
        btrim(i.sku) as sku,
        btrim(i.pool_name) as pool_name,
        coalesce(nullif(btrim(m.inventory_channel), ''), '其他') as inventory_channel,
        i.available_qty,
        i.snapshot_date,
        i.loaded_at
    from anta_daily.src_inventory_current i
    join latest_inventory_date lid
      on lid.snapshot_date = i.snapshot_date
    left join anta_daily.src_inventory_channel_map m
      on btrim(m.pool_name) = btrim(i.pool_name)
    where nullif(btrim(i.sku), '') is not null
      and coalesce(i.sku, '') not ilike '%u%'
      and coalesce(i.sku, '') not ilike '%v%'
),
inventory_sku_totals as (
    select
        sku,
        sum(available_qty) as raw_inventory_total_qty
    from inventory_raw
    group by sku
),
inventory_scope as (
    select sku
    from inventory_sku_totals
    where raw_inventory_total_qty > 100
),
inventory_detail as (
    select
        sku,
        max(snapshot_date) as inventory_snapshot_date,
        coalesce(sum(available_qty) filter (where inventory_channel = '货通'), 0) as inv_huotong_qty,
        coalesce(sum(available_qty) filter (where pool_name = 'anta奥特莱斯虚仓'), 0) as inv_outlet_exclusive_qty,
        coalesce(sum(available_qty) filter (where pool_name = '安踏大货淘宝C店独享仓'), 0) as inv_c_store_exclusive_qty,
        coalesce(sum(available_qty) filter (where pool_name = 'outlets预售仓'), 0) as inv_outlets_presale_qty,
        coalesce(sum(available_qty) filter (where pool_name = '电商总仓'), 0) as inv_ecommerce_warehouse_qty,
        coalesce(sum(available_qty) filter (where pool_name = '安踏大货共享仓'), 0) as inv_bulk_shared_qty,
        coalesce(sum(available_qty) filter (where pool_name = '安踏大货新品共享仓'), 0) as inv_bulk_new_shared_qty,
        coalesce(sum(available_qty) filter (where pool_name = '传统电商共享仓'), 0) as inv_traditional_shared_qty,
        coalesce(sum(available_qty) filter (where pool_name = '天猫渠道组专用共享仓'), 0) as inv_tmall_shared_qty,
        coalesce(sum(available_qty) filter (where pool_name = '品类旗舰共享仓'), 0) as inv_category_flagship_shared_qty,
        coalesce(sum(available_qty) filter (where pool_name = '大货线上共享平台'), 0) as inv_online_shared_platform_qty,
        coalesce(sum(available_qty) filter (where pool_name = '兴趣电商直营共享降解虚仓'), 0) as inv_interest_degrade_shared_qty,
        coalesce(sum(available_qty) filter (where pool_name = '抖得拼-电商大货共享仓'), 0) as inv_doudp_shared_qty,
        coalesce(sum(available_qty) filter (where pool_name = '大货降解独享仓'), 0) as inv_bulk_degrade_exclusive_qty,
        coalesce(sum(available_qty) filter (where pool_name = 'JITX虚仓'), 0) as inv_jitx_qty,
        coalesce(sum(available_qty) filter (where pool_name = '拼多多虚仓-JITX2'), 0) as inv_pdd_jitx2_qty,
        max(loaded_at) as inventory_loaded_at
    from inventory_raw
    group by sku
),
sales_rows as (
    select
        btrim(s.sku) as sku,
        s.store_name,
        coalesce(nullif(btrim(m.sales_channel), ''), '其他') as sales_channel,
        s.sales_qty,
        s.sales_amount,
        s.tag_amount,
        s.loaded_at
    from anta_daily.src_sales_history s
    cross join date_params p
    left join anta_daily.src_sales_channel_map m
      on btrim(m.store_name) = btrim(s.store_name)
    where s.sales_date between p.date_from and p.date_to
      and s.doc_type in ('销售单', '退货单', '换货单')
      and nullif(btrim(s.sku), '') is not null
      and coalesce(s.sku, '') not ilike '%u%'
      and coalesce(s.sku, '') not ilike '%v%'
),
sales_mapped as (
    select
        sku,
        case
            when sales_channel = '删除' then '删除'
            when sales_channel = '奥莱安建立' or store_name ilike '%安建立%' then 'outlet_anjianli'
            when sales_channel in ('天猫奥莱', '奥莱') then 'outlet'
            when sales_channel = 'C店' then 'c_store'
            when sales_channel = '唯品' then 'vip'
            when sales_channel = '拼多多' then 'pdd'
            when sales_channel = '上海专卖' then 'shanghai'
            when sales_channel = '天猫旗舰' then 'tmall_flagship'
            when sales_channel = '天猫专卖' then 'tmall_franchise'
            when sales_channel in ('京东旗舰', '京东专卖', '京自营', '京东') then 'jd'
            when sales_channel = '兴趣' then 'interest'
            when sales_channel = '潮流' then 'trend'
            when sales_channel = '户外' then 'outdoor'
            when sales_channel = '女子' then 'women'
            when sales_channel = '休闲' then 'casual'
            when sales_channel = '得物' then 'dewu'
            when sales_channel = '经销' then 'distributor'
            when sales_channel = '团购' then 'group_buy'
            else 'other'
        end as outlet_channel,
        sales_qty,
        sales_amount,
        tag_amount,
        loaded_at
    from sales_rows
),
sales_filtered as (
    select *
    from sales_mapped
    where outlet_channel <> '删除'
),
sales_scope as (
    select sku
    from sales_filtered
    group by sku
    having coalesce(sum(sales_qty), 0) <> 0
),
sku_scope as (
    select sku from inventory_scope
    union
    select sku from sales_scope
),
sales_pivot as (
    select
        sku,
        coalesce(sum(sales_qty) filter (where outlet_channel = 'outlet'), 0) as sales_outlet_qty,
        coalesce(sum(sales_qty) filter (where outlet_channel = 'outlet_anjianli'), 0) as sales_outlet_anjianli_qty,
        coalesce(sum(sales_qty) filter (where outlet_channel = 'c_store'), 0) as sales_c_store_qty,
        coalesce(sum(sales_qty) filter (where outlet_channel = 'vip'), 0) as sales_vip_qty,
        coalesce(sum(sales_qty) filter (where outlet_channel = 'pdd'), 0) as sales_pdd_qty,
        coalesce(sum(sales_qty) filter (where outlet_channel = 'shanghai'), 0) as sales_shanghai_qty,
        coalesce(sum(sales_qty) filter (where outlet_channel = 'tmall_flagship'), 0) as sales_tmall_flagship_qty,
        coalesce(sum(sales_qty) filter (where outlet_channel = 'tmall_franchise'), 0) as sales_tmall_franchise_qty,
        coalesce(sum(sales_qty) filter (where outlet_channel = 'other'), 0) as sales_other_qty,
        coalesce(sum(sales_qty) filter (where outlet_channel = 'jd'), 0) as sales_jd_qty,
        coalesce(sum(sales_qty) filter (where outlet_channel = 'interest'), 0) as sales_interest_qty,
        coalesce(sum(sales_qty) filter (where outlet_channel = 'trend'), 0) as sales_trend_qty,
        coalesce(sum(sales_qty) filter (where outlet_channel = 'outdoor'), 0) as sales_outdoor_qty,
        coalesce(sum(sales_qty) filter (where outlet_channel = 'women'), 0) as sales_women_qty,
        coalesce(sum(sales_qty) filter (where outlet_channel = 'casual'), 0) as sales_casual_qty,
        coalesce(sum(sales_qty) filter (where outlet_channel = 'dewu'), 0) as sales_dewu_qty,
        coalesce(sum(sales_qty) filter (where outlet_channel = 'distributor'), 0) as sales_distributor_qty,
        coalesce(sum(sales_qty) filter (where outlet_channel = 'group_buy'), 0) as sales_group_buy_qty,
        coalesce(sum(sales_qty), 0) as sales_total_qty,
        round(sum(sales_amount) filter (where outlet_channel = 'outlet') / nullif(sum(tag_amount) filter (where outlet_channel = 'outlet'), 0), 6) as discount_outlet,
        round(sum(sales_amount) filter (where outlet_channel = 'outlet_anjianli') / nullif(sum(tag_amount) filter (where outlet_channel = 'outlet_anjianli'), 0), 6) as discount_outlet_anjianli,
        round(sum(sales_amount) filter (where outlet_channel = 'c_store') / nullif(sum(tag_amount) filter (where outlet_channel = 'c_store'), 0), 6) as discount_c_store,
        round(sum(sales_amount) filter (where outlet_channel = 'vip') / nullif(sum(tag_amount) filter (where outlet_channel = 'vip'), 0), 6) as discount_vip,
        round(sum(sales_amount) filter (where outlet_channel = 'pdd') / nullif(sum(tag_amount) filter (where outlet_channel = 'pdd'), 0), 6) as discount_pdd,
        round(sum(sales_amount) filter (where outlet_channel = 'shanghai') / nullif(sum(tag_amount) filter (where outlet_channel = 'shanghai'), 0), 6) as discount_shanghai,
        round(sum(sales_amount) filter (where outlet_channel = 'tmall_flagship') / nullif(sum(tag_amount) filter (where outlet_channel = 'tmall_flagship'), 0), 6) as discount_tmall_flagship,
        round(sum(sales_amount) filter (where outlet_channel = 'tmall_franchise') / nullif(sum(tag_amount) filter (where outlet_channel = 'tmall_franchise'), 0), 6) as discount_tmall_franchise,
        round(sum(sales_amount) filter (where outlet_channel = 'other') / nullif(sum(tag_amount) filter (where outlet_channel = 'other'), 0), 6) as discount_other,
        round(sum(sales_amount) filter (where outlet_channel = 'jd') / nullif(sum(tag_amount) filter (where outlet_channel = 'jd'), 0), 6) as discount_jd,
        round(sum(sales_amount) filter (where outlet_channel = 'interest') / nullif(sum(tag_amount) filter (where outlet_channel = 'interest'), 0), 6) as discount_interest,
        round(sum(sales_amount) filter (where outlet_channel = 'trend') / nullif(sum(tag_amount) filter (where outlet_channel = 'trend'), 0), 6) as discount_trend,
        round(sum(sales_amount) filter (where outlet_channel = 'outdoor') / nullif(sum(tag_amount) filter (where outlet_channel = 'outdoor'), 0), 6) as discount_outdoor,
        round(sum(sales_amount) filter (where outlet_channel = 'women') / nullif(sum(tag_amount) filter (where outlet_channel = 'women'), 0), 6) as discount_women,
        round(sum(sales_amount) filter (where outlet_channel = 'casual') / nullif(sum(tag_amount) filter (where outlet_channel = 'casual'), 0), 6) as discount_casual,
        round(sum(sales_amount) filter (where outlet_channel = 'dewu') / nullif(sum(tag_amount) filter (where outlet_channel = 'dewu'), 0), 6) as discount_dewu,
        round(sum(sales_amount) filter (where outlet_channel = 'distributor') / nullif(sum(tag_amount) filter (where outlet_channel = 'distributor'), 0), 6) as discount_distributor,
        round(sum(sales_amount) / nullif(sum(tag_amount), 0), 6) as discount_total,
        max(loaded_at) as sales_loaded_at
    from sales_filtered
    group by sku
)
select
    pd.season,
    pd.style,
    sc.sku,
    pd.major_category,
    pd.category,
    pd.product_name,
    pd.gender,
    pd.tag_price,
    pd.story_pack,
    ''::text as listing_outlet,
    ''::text as listing_c_store,
    ''::text as remark,
    ''::text as enter_xiaodengta,
    round(
        (
          coalesce(id.inv_huotong_qty, 0)
          + coalesce(id.inv_ecommerce_warehouse_qty, 0)
          + coalesce(id.inv_bulk_shared_qty, 0)
          + coalesce(id.inv_traditional_shared_qty, 0)
          + coalesce(id.inv_interest_degrade_shared_qty, 0)
        ) * 0.3
        + (
          coalesce(id.inv_outlet_exclusive_qty, 0)
          + coalesce(id.inv_c_store_exclusive_qty, 0)
          + coalesce(id.inv_tmall_shared_qty, 0)
          + coalesce(id.inv_category_flagship_shared_qty, 0)
          + coalesce(id.inv_online_shared_platform_qty, 0)
          + coalesce(id.inv_doudp_shared_qty, 0)
          + coalesce(id.inv_bulk_degrade_exclusive_qty, 0)
        ) * 0.5
    ) as outlet_available_qty,
    coalesce(id.inv_huotong_qty, 0) as inv_huotong_qty,
    coalesce(id.inv_outlet_exclusive_qty, 0) as inv_outlet_exclusive_qty,
    coalesce(id.inv_c_store_exclusive_qty, 0) as inv_c_store_exclusive_qty,
    coalesce(id.inv_outlets_presale_qty, 0) as inv_outlets_presale_qty,
    coalesce(id.inv_ecommerce_warehouse_qty, 0) as inv_ecommerce_warehouse_qty,
    coalesce(id.inv_bulk_shared_qty, 0) as inv_bulk_shared_qty,
    coalesce(id.inv_bulk_new_shared_qty, 0) as inv_bulk_new_shared_qty,
    coalesce(id.inv_traditional_shared_qty, 0) as inv_traditional_shared_qty,
    coalesce(id.inv_tmall_shared_qty, 0) as inv_tmall_shared_qty,
    coalesce(id.inv_category_flagship_shared_qty, 0) as inv_category_flagship_shared_qty,
    coalesce(id.inv_online_shared_platform_qty, 0) as inv_online_shared_platform_qty,
    coalesce(id.inv_interest_degrade_shared_qty, 0) as inv_interest_degrade_shared_qty,
    coalesce(id.inv_doudp_shared_qty, 0) as inv_doudp_shared_qty,
    coalesce(id.inv_bulk_degrade_exclusive_qty, 0) as inv_bulk_degrade_exclusive_qty,
    coalesce(id.inv_jitx_qty, 0) as inv_jitx_qty,
    coalesce(id.inv_pdd_jitx2_qty, 0) as inv_pdd_jitx2_qty,
    (
      coalesce(id.inv_huotong_qty, 0)
      + coalesce(id.inv_outlet_exclusive_qty, 0)
      + coalesce(id.inv_c_store_exclusive_qty, 0)
      + coalesce(id.inv_outlets_presale_qty, 0)
      + coalesce(id.inv_ecommerce_warehouse_qty, 0)
      + coalesce(id.inv_bulk_shared_qty, 0)
      + coalesce(id.inv_bulk_new_shared_qty, 0)
      + coalesce(id.inv_traditional_shared_qty, 0)
      + coalesce(id.inv_tmall_shared_qty, 0)
      + coalesce(id.inv_category_flagship_shared_qty, 0)
      + coalesce(id.inv_online_shared_platform_qty, 0)
      + coalesce(id.inv_interest_degrade_shared_qty, 0)
      + coalesce(id.inv_doudp_shared_qty, 0)
      + coalesce(id.inv_bulk_degrade_exclusive_qty, 0)
    ) as inventory_total_qty,
    coalesce(sp.sales_outlet_qty, 0) as sales_outlet_qty,
    coalesce(sp.sales_outlet_anjianli_qty, 0) as sales_outlet_anjianli_qty,
    coalesce(sp.sales_c_store_qty, 0) as sales_c_store_qty,
    coalesce(sp.sales_vip_qty, 0) as sales_vip_qty,
    coalesce(sp.sales_pdd_qty, 0) as sales_pdd_qty,
    coalesce(sp.sales_shanghai_qty, 0) as sales_shanghai_qty,
    coalesce(sp.sales_tmall_flagship_qty, 0) as sales_tmall_flagship_qty,
    coalesce(sp.sales_tmall_franchise_qty, 0) as sales_tmall_franchise_qty,
    coalesce(sp.sales_other_qty, 0) as sales_other_qty,
    coalesce(sp.sales_jd_qty, 0) as sales_jd_qty,
    coalesce(sp.sales_interest_qty, 0) as sales_interest_qty,
    coalesce(sp.sales_trend_qty, 0) as sales_trend_qty,
    coalesce(sp.sales_outdoor_qty, 0) as sales_outdoor_qty,
    coalesce(sp.sales_women_qty, 0) as sales_women_qty,
    coalesce(sp.sales_casual_qty, 0) as sales_casual_qty,
    coalesce(sp.sales_dewu_qty, 0) as sales_dewu_qty,
    coalesce(sp.sales_distributor_qty, 0) as sales_distributor_qty,
    coalesce(sp.sales_group_buy_qty, 0) as sales_group_buy_qty,
    coalesce(sp.sales_total_qty, 0) as sales_total_qty,
    sp.discount_outlet,
    sp.discount_outlet_anjianli,
    sp.discount_c_store,
    sp.discount_vip,
    sp.discount_pdd,
    sp.discount_shanghai,
    sp.discount_tmall_flagship,
    sp.discount_tmall_franchise,
    sp.discount_other,
    sp.discount_jd,
    sp.discount_interest,
    sp.discount_trend,
    sp.discount_outdoor,
    sp.discount_women,
    sp.discount_casual,
    sp.discount_dewu,
    sp.discount_distributor,
    sp.discount_total,
    id.inventory_snapshot_date,
    greatest(
      coalesce(id.inventory_loaded_at, to_timestamp(0)),
      coalesce(sp.sales_loaded_at, to_timestamp(0))
    ) as loaded_at
from sku_scope sc
left join product_dim pd
  on pd.sku = sc.sku
left join inventory_detail id
  on id.sku = sc.sku
left join sales_pivot sp
  on sp.sku = sc.sku
order by pd.season nulls last, sc.sku
`;

function monthLabel(dateText, fallback = "销售") {
  const value = normalizeDateInput(dateText);
  if (!value) {
    return fallback;
  }
  const month = Number(value.slice(5, 7));
  return Number.isFinite(month) && month > 0 ? `${month}月${fallback}` : fallback;
}

function inventoryUpdateLabel(inventoryDate) {
  const value = normalizeDateInput(inventoryDate);
  if (!value) {
    return "库存更新";
  }
  return `${value.slice(5, 7)}${value.slice(8, 10)}库存更新`;
}

function buildOutletAssortmentGroupHeaders({ inventoryDate = "", dateTo = "" } = {}) {
  const group = Array(OUTLET_ASSORTMENT_COLUMNS.length).fill("");
  group[0] = inventoryUpdateLabel(inventoryDate);
  group[9] = "上架情况";
  group[13] = "前端同步";
  group[14] = "货通";
  group[15] = "独享仓";
  group[18] = "正价共享";
  group[27] = "降解共享";
  group[28] = "降解共享";
  group[29] = "降解共享";
  group[31] = monthLabel(dateTo, "销售");
  group[50] = monthLabel(dateTo, "折扣");
  return group;
}

function normalizeOutletAssortmentValue(key, value, mode = "display") {
  if (PERCENT_KEYS.has(key)) {
    if (mode === "raw") {
      return value === null || value === undefined || value === "" ? null : toNumber(value);
    }
    return toPercentText(value);
  }
  if (NUMERIC_KEYS.has(key)) {
    return toIntValue(value);
  }
  if (TEXT_KEYS.has(key)) {
    return toText(value);
  }
  return value;
}

function toOutletAssortmentRow(row, mode = "display") {
  return OUTLET_ASSORTMENT_COLUMNS.map((column) => normalizeOutletAssortmentValue(column.key, row[column.key], mode));
}

function toOutletAssortmentExportObject(row) {
  const output = {};
  for (const column of OUTLET_ASSORTMENT_COLUMNS) {
    output[column.key] = normalizeOutletAssortmentValue(column.key, row[column.key], "raw");
  }
  return output;
}

function makeCacheKey(dateFrom, dateTo) {
  return `${dateFrom}|${dateTo}`;
}

function getCachedRows(dateFrom, dateTo) {
  const key = makeCacheKey(dateFrom, dateTo);
  const cached = OUTLET_ASSORTMENT_CACHE.get(key);
  if (!cached) {
    return null;
  }
  if (Date.now() - Number(cached.savedAt || 0) > REPORT_CACHE_TTL_MS) {
    OUTLET_ASSORTMENT_CACHE.delete(key);
    return null;
  }
  return cached.rows || null;
}

function setCachedRows(dateFrom, dateTo, rows) {
  OUTLET_ASSORTMENT_CACHE.set(makeCacheKey(dateFrom, dateTo), {
    savedAt: Date.now(),
    rows: Array.isArray(rows) ? rows : [],
  });
}

function clearOutletAssortmentCache() {
  OUTLET_ASSORTMENT_CACHE.clear();
}

async function getOutletAssortmentDateChoices() {
  const pool = await getPool();
  const result = await timedQuery(
    pool,
    `
      select to_char(sales_date, 'YYYY-MM-DD') as sales_date
      from (
        select distinct sales_date
        from anta_daily.rpt_sales_sku_daily
      ) d
      order by sales_date
    `,
    [],
    "getOutletAssortmentDateChoices"
  );
  const salesDates = (result.rows || []).map((row) => String(row.sales_date || "")).filter(Boolean);
  const defaultDateTo = salesDates.length ? salesDates[salesDates.length - 1] : "";
  const defaultDateFrom = defaultDateTo ? `${defaultDateTo.slice(0, 8)}01` : "";
  return {
    salesDates,
    defaultDateFrom,
    defaultDateTo,
  };
}

async function resolveOutletAssortmentRange(dateFromText, dateToText) {
  const choices = await getOutletAssortmentDateChoices();
  const normalized = normalizeDailyRangeInput(dateFromText, dateToText);
  if (!normalized.dateFrom && !normalized.dateTo) {
    return {
      dateFrom: choices.defaultDateFrom,
      dateTo: choices.defaultDateTo,
      salesDates: choices.salesDates,
    };
  }
  return {
    dateFrom: normalized.dateFrom,
    dateTo: normalized.dateTo,
    salesDates: choices.salesDates,
  };
}

async function queryOutletAssortmentBaseRows(dateFrom, dateTo) {
  const cached = getCachedRows(dateFrom, dateTo);
  if (cached) {
    return cached;
  }
  const pool = await getPool();
  const result = await timedQuery(pool, OUTLET_ASSORTMENT_SQL, [dateFrom, dateTo], "queryOutletAssortmentBaseRows");
  const rows = result.rows || [];
  setCachedRows(dateFrom, dateTo, rows);
  return rows;
}

function summarizeOutletAssortmentRows(rows) {
  let inventoryDate = "";
  let generatedAt = "";
  for (const row of rows || []) {
    const d = toDateText(row.inventory_snapshot_date);
    if (d && (!inventoryDate || d > inventoryDate)) {
      inventoryDate = d;
    }
    const ts = dateTimeText(row.loaded_at);
    if (ts && (!generatedAt || ts > generatedAt)) {
      generatedAt = ts;
    }
  }
  return {
    inventory_date: inventoryDate,
    generated_at: generatedAt,
    row_count: Array.isArray(rows) ? rows.length : 0,
  };
}

async function getOutletAssortmentMeta({ dateFrom, dateTo }) {
  const rows = await queryOutletAssortmentBaseRows(dateFrom, dateTo);
  const summary = summarizeOutletAssortmentRows(rows);
  return {
    date_from: dateFrom,
    date_to: dateTo,
    inventory_date: summary.inventory_date,
    group_headers: buildOutletAssortmentGroupHeaders({
      inventoryDate: summary.inventory_date,
      dateTo,
    }),
    column_headers: OUTLET_ASSORTMENT_COLUMNS.map((column) => column.header),
    row_count: summary.row_count,
    generated_at: summary.generated_at,
  };
}

async function getOutletAssortmentRows({ dateFrom, dateTo, page, pageSize, keyword, fuzzy }) {
  const rows = await queryOutletAssortmentBaseRows(dateFrom, dateTo);
  const filtered = filterObjectRowsByKeyword(rows, keyword, fuzzy);
  const paged = paginateRows(filtered, page, pageSize);
  return {
    items: paged.items.map((row) => toOutletAssortmentRow(row)),
    total: paged.total,
    page: paged.page,
    pageSize: paged.pageSize,
  };
}

async function getOutletAssortmentExportRows({ dateFrom, dateTo }) {
  const rows = await queryOutletAssortmentBaseRows(dateFrom, dateTo);
  return rows.map((row) => toOutletAssortmentExportObject(row));
}

module.exports = {
  OUTLET_ASSORTMENT_COLUMNS,
  OUTLET_ASSORTMENT_SQL,
  buildOutletAssortmentGroupHeaders,
  inventoryUpdateLabel,
  monthLabel,
  toOutletAssortmentRow,
  toOutletAssortmentExportObject,
  clearOutletAssortmentCache,
  getOutletAssortmentDateChoices,
  resolveOutletAssortmentRange,
  queryOutletAssortmentBaseRows,
  summarizeOutletAssortmentRows,
  getOutletAssortmentMeta,
  getOutletAssortmentRows,
  getOutletAssortmentExportRows,
};
