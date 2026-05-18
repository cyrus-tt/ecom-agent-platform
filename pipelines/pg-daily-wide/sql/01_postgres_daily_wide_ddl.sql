begin;

create schema if not exists anta_daily;

create or replace function anta_daily.is_report_sku(input_sku text)
returns boolean
language sql
immutable
as $$
    select
        input_sku is not null
        and position('u' in lower(input_sku)) = 0
        and position('v' in lower(input_sku)) = 0
$$;

create table if not exists anta_daily.src_inventory_current (
    snapshot_date date not null,
    pool_name text not null,
    sku text not null,
    size_code text,
    available_qty numeric(18,2) not null,
    source_file text not null,
    loaded_at timestamptz not null default now()
);

create table if not exists anta_daily.src_sales_history (
    sales_date date not null,
    doc_type text not null,
    store_name text not null,
    sku text not null,
    sales_qty numeric(18,2) not null,
    sales_amount numeric(18,6) not null,
    tag_amount numeric(18,2) not null,
    source_file text not null,
    loaded_at timestamptz not null default now()
);

create table if not exists anta_daily.src_product_master_current (
    sku text not null,
    style text,
    major_category text,
    category text,
    product_name text,
    tag_price numeric(18,2),
    season text,
    gender text,
    story_pack text,
    source_file text not null,
    loaded_at timestamptz not null default now()
);

create table if not exists anta_daily.src_inventory_channel_map (
    pool_name text not null,
    inventory_channel text,
    source_file text not null,
    loaded_at timestamptz not null default now()
);

create table if not exists anta_daily.src_sales_channel_map (
    store_name text not null,
    sales_channel text,
    source_file text not null,
    loaded_at timestamptz not null default now()
);

create index if not exists idx_src_inventory_current_date_sku
    on anta_daily.src_inventory_current (snapshot_date, sku);

create index if not exists idx_src_sales_history_date_sku
    on anta_daily.src_sales_history (sales_date, sku);

create index if not exists idx_src_product_master_current_sku
    on anta_daily.src_product_master_current (sku);

create index if not exists idx_src_inventory_channel_map_pool
    on anta_daily.src_inventory_channel_map (pool_name);

create index if not exists idx_src_sales_channel_map_store
    on anta_daily.src_sales_channel_map (store_name);

create index if not exists idx_src_inventory_channel_map_pool_norm
    on anta_daily.src_inventory_channel_map (btrim(pool_name));

create index if not exists idx_src_sales_channel_map_store_norm
    on anta_daily.src_sales_channel_map (btrim(store_name));

create table if not exists anta_daily.rpt_daily_sku_wide (
    sales_date date not null,
    style text,
    sku text not null,
    major_category text,
    category text,
    product_name text,
    tag_price numeric(18,2),
    season text,
    gender text,
    story_pack text,
    inv_huotong_qty numeric(18,2) not null default 0,
    inv_women_qty numeric(18,2) not null default 0,
    inv_outdoor_qty numeric(18,2) not null default 0,
    inv_trend_qty numeric(18,2) not null default 0,
    inv_casual_qty numeric(18,2) not null default 0,
    inv_c_store_qty numeric(18,2) not null default 0,
    inv_category_shared_qty numeric(18,2) not null default 0,
    inv_tmall_outlet_qty numeric(18,2) not null default 0,
    inv_shared_qty numeric(18,2) not null default 0,
    inv_tmall_flagship_qty numeric(18,2) not null default 0,
    inv_tmall_franchise_qty numeric(18,2) not null default 0,
    inv_shanghai_franchise_qty numeric(18,2) not null default 0,
    inv_jd_flagship_qty numeric(18,2) not null default 0,
    inv_jd_franchise_qty numeric(18,2) not null default 0,
    inv_jd_self_qty numeric(18,2) not null default 0,
    inv_dewu_qty numeric(18,2) not null default 0,
    inv_interest_qty numeric(18,2) not null default 0,
    inv_vip_qty numeric(18,2) not null default 0,
    inv_pdd_qty numeric(18,2) not null default 0,
    inv_distributor_qty numeric(18,2) not null default 0,
    inv_other_qty numeric(18,2) not null default 0,
    inventory_total_qty numeric(18,2) not null default 0,
    sales_women_qty numeric(18,2) not null default 0,
    sales_outdoor_qty numeric(18,2) not null default 0,
    sales_trend_qty numeric(18,2) not null default 0,
    sales_casual_qty numeric(18,2) not null default 0,
    sales_tmall_badminton_qty numeric(18,2) not null default 0,
    sales_tmall_outlet_qty numeric(18,2) not null default 0,
    sales_c_store_qty numeric(18,2) not null default 0,
    sales_outlet_anjianli_qty numeric(18,2) not null default 0,
    sales_tmall_flagship_qty numeric(18,2) not null default 0,
    sales_tmall_franchise_qty numeric(18,2) not null default 0,
    sales_shanghai_franchise_qty numeric(18,2) not null default 0,
    sales_jd_flagship_qty numeric(18,2) not null default 0,
    sales_jd_franchise_qty numeric(18,2) not null default 0,
    sales_jd_self_qty numeric(18,2) not null default 0,
    sales_dewu_qty numeric(18,2) not null default 0,
    sales_vip_qty numeric(18,2) not null default 0,
    sales_pdd_qty numeric(18,2) not null default 0,
    sales_interest_qty numeric(18,2) not null default 0,
    sales_official_qty numeric(18,2) not null default 0,
    sales_group_buy_qty numeric(18,2) not null default 0,
    sales_distributor_qty numeric(18,2) not null default 0,
    sales_other_qty numeric(18,2) not null default 0,
    sales_total_qty numeric(18,2) not null default 0,
    sku_discount_women numeric(12,6),
    sku_discount_outdoor numeric(12,6),
    sku_discount_trend numeric(12,6),
    sku_discount_casual numeric(12,6),
    sku_discount_tmall_badminton numeric(12,6),
    sku_discount_tmall_outlet numeric(12,6),
    sku_discount_c_store numeric(12,6),
    sku_discount_outlet_anjianli numeric(12,6),
    sku_discount_tmall_flagship numeric(12,6),
    sku_discount_tmall_franchise numeric(12,6),
    sku_discount_shanghai_franchise numeric(12,6),
    sku_discount_jd_flagship numeric(12,6),
    sku_discount_jd_franchise numeric(12,6),
    sku_discount_jd_self numeric(12,6),
    sku_discount_dewu numeric(12,6),
    sku_discount_vip numeric(12,6),
    sku_discount_pdd numeric(12,6),
    sku_discount_interest numeric(12,6),
    sku_discount_official numeric(12,6),
    sku_discount_group_buy numeric(12,6),
    sku_discount_distributor numeric(12,6),
    sku_discount_other numeric(12,6),
    sku_discount_total numeric(12,6),
    style_discount_women numeric(12,6),
    style_discount_outdoor numeric(12,6),
    style_discount_trend numeric(12,6),
    style_discount_casual numeric(12,6),
    style_discount_tmall_badminton numeric(12,6),
    style_discount_tmall_outlet numeric(12,6),
    style_discount_c_store numeric(12,6),
    style_discount_outlet_anjianli numeric(12,6),
    style_discount_tmall_flagship numeric(12,6),
    style_discount_tmall_franchise numeric(12,6),
    style_discount_shanghai_franchise numeric(12,6),
    style_discount_jd_flagship numeric(12,6),
    style_discount_jd_franchise numeric(12,6),
    style_discount_jd_self numeric(12,6),
    style_discount_dewu numeric(12,6),
    style_discount_vip numeric(12,6),
    style_discount_pdd numeric(12,6),
    style_discount_interest numeric(12,6),
    style_discount_official numeric(12,6),
    style_discount_group_buy numeric(12,6),
    style_discount_distributor numeric(12,6),
    style_discount_other numeric(12,6),
    style_discount_total numeric(12,6),
    inventory_snapshot_date date,
    loaded_at timestamptz not null default now(),
    primary key (sales_date, sku)
);

create or replace view anta_daily.v_rpt_daily_sku_wide_export as
select
    sales_date as "出库时间",
    style as "款号",
    sku as "货号",
    major_category as "大类",
    category as "中类",
    product_name as "品名",
    tag_price as "零售价",
    season as "年季",
    gender as "性别",
    story_pack as "故事包",
    inv_huotong_qty as "库存_货通",
    inv_women_qty as "库存_女子",
    inv_outdoor_qty as "库存_户外",
    inv_trend_qty as "库存_潮流",
    inv_casual_qty as "库存_休闲",
    inv_c_store_qty as "库存_C店",
    inv_category_shared_qty as "库存_品类共享",
    inv_tmall_outlet_qty as "库存_天猫奥莱",
    inv_shared_qty as "库存_共享",
    inv_tmall_flagship_qty as "库存_天猫旗舰",
    inv_tmall_franchise_qty as "库存_天猫专卖",
    inv_shanghai_franchise_qty as "库存_上海专卖",
    inv_jd_flagship_qty as "库存_京东旗舰",
    inv_jd_franchise_qty as "库存_京东专卖",
    inv_jd_self_qty as "库存_京自营",
    inv_dewu_qty as "库存_得物",
    inv_interest_qty as "库存_兴趣",
    inv_vip_qty as "库存_唯品",
    inv_pdd_qty as "库存_拼多多",
    inv_distributor_qty as "库存_经销",
    inv_other_qty as "库存_其他",
    inventory_total_qty as "全渠道库存",
    sales_women_qty as "销售_女子",
    sales_outdoor_qty as "销售_户外",
    sales_trend_qty as "销售_潮流",
    sales_casual_qty as "销售_休闲",
    sales_tmall_badminton_qty as "销售_天猫羽球",
    sales_tmall_outlet_qty as "销售_天猫奥莱",
    sales_c_store_qty as "销售_C店",
    sales_outlet_anjianli_qty as "销售_奥莱安建立",
    sales_tmall_flagship_qty as "销售_天猫旗舰",
    sales_tmall_franchise_qty as "销售_天猫专卖",
    sales_shanghai_franchise_qty as "销售_上海专卖",
    sales_jd_flagship_qty as "销售_京东旗舰",
    sales_jd_franchise_qty as "销售_京东专卖",
    sales_jd_self_qty as "销售_京自营",
    sales_dewu_qty as "销售_得物",
    sales_vip_qty as "销售_唯品",
    sales_pdd_qty as "销售_拼多多",
    sales_interest_qty as "销售_兴趣",
    sales_official_qty as "销售_官网",
    sales_group_buy_qty as "销售_团购",
    sales_distributor_qty as "销售_经销",
    sales_other_qty as "销售_其他",
    sales_total_qty as "全渠道销售",
    sku_discount_women as "货号折扣_女子",
    sku_discount_outdoor as "货号折扣_户外",
    sku_discount_trend as "货号折扣_潮流",
    sku_discount_casual as "货号折扣_休闲",
    sku_discount_tmall_badminton as "货号折扣_天猫羽球",
    sku_discount_tmall_outlet as "货号折扣_天猫奥莱",
    sku_discount_c_store as "货号折扣_C店",
    sku_discount_outlet_anjianli as "货号折扣_奥莱安建立",
    sku_discount_tmall_flagship as "货号折扣_天猫旗舰",
    sku_discount_tmall_franchise as "货号折扣_天猫专卖",
    sku_discount_shanghai_franchise as "货号折扣_上海专卖",
    sku_discount_jd_flagship as "货号折扣_京东旗舰",
    sku_discount_jd_franchise as "货号折扣_京东专卖",
    sku_discount_jd_self as "货号折扣_京自营",
    sku_discount_dewu as "货号折扣_得物",
    sku_discount_vip as "货号折扣_唯品",
    sku_discount_pdd as "货号折扣_拼多多",
    sku_discount_interest as "货号折扣_兴趣",
    sku_discount_official as "货号折扣_官网",
    sku_discount_group_buy as "货号折扣_团购",
    sku_discount_distributor as "货号折扣_经销",
    sku_discount_other as "货号折扣_其他",
    sku_discount_total as "全渠道折扣_货号层级",
    style_discount_women as "款号折扣_女子",
    style_discount_outdoor as "款号折扣_户外",
    style_discount_trend as "款号折扣_潮流",
    style_discount_casual as "款号折扣_休闲",
    style_discount_tmall_badminton as "款号折扣_天猫羽球",
    style_discount_tmall_outlet as "款号折扣_天猫奥莱",
    style_discount_c_store as "款号折扣_C店",
    style_discount_outlet_anjianli as "款号折扣_奥莱安建立",
    style_discount_tmall_flagship as "款号折扣_天猫旗舰",
    style_discount_tmall_franchise as "款号折扣_天猫专卖",
    style_discount_shanghai_franchise as "款号折扣_上海专卖",
    style_discount_jd_flagship as "款号折扣_京东旗舰",
    style_discount_jd_franchise as "款号折扣_京东专卖",
    style_discount_jd_self as "款号折扣_京自营",
    style_discount_dewu as "款号折扣_得物",
    style_discount_vip as "款号折扣_唯品",
    style_discount_pdd as "款号折扣_拼多多",
    style_discount_interest as "款号折扣_兴趣",
    style_discount_official as "款号折扣_官网",
    style_discount_group_buy as "款号折扣_团购",
    style_discount_distributor as "款号折扣_经销",
    style_discount_other as "款号折扣_其他",
    style_discount_total as "全渠道折扣_款号层级"
from anta_daily.rpt_daily_sku_wide;

commit;
