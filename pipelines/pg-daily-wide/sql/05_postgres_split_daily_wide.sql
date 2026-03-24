begin;

create schema if not exists anta_daily;

create table if not exists anta_daily.rpt_sales_sku_daily (
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
    sales_total_amount numeric(18,6) not null default 0,
    sales_total_tag_amount numeric(18,2) not null default 0,
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
    loaded_at timestamptz not null default now(),
    primary key (sales_date, sku)
);

create table if not exists anta_daily.rpt_inventory_sku_latest (
    inventory_snapshot_date date not null,
    style text,
    sku text not null primary key,
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
    loaded_at timestamptz not null default now()
);

create index if not exists idx_rpt_sales_sku_daily_sku
    on anta_daily.rpt_sales_sku_daily (sku);

create index if not exists idx_rpt_sales_sku_daily_upper_sku
    on anta_daily.rpt_sales_sku_daily (upper(sku));

create index if not exists idx_rpt_sales_sku_daily_upper_style
    on anta_daily.rpt_sales_sku_daily (upper(style));

create index if not exists idx_rpt_inventory_sku_latest_upper_sku
    on anta_daily.rpt_inventory_sku_latest (upper(sku));

alter table anta_daily.rpt_sales_sku_daily
    add column if not exists sales_total_amount numeric(18,6) not null default 0;

alter table anta_daily.rpt_sales_sku_daily
    add column if not exists sales_total_tag_amount numeric(18,2) not null default 0;

drop table if exists pg_temp.tmp_sales_rebuild_scope;

create temporary table pg_temp.tmp_sales_rebuild_scope as
with target_has_rows as (
    select exists(select 1 from anta_daily.rpt_sales_sku_daily limit 1) as has_rows
),
latest_sales_batch as (
    select max(loaded_at) as loaded_at
    from anta_daily.src_sales_history
)
select distinct s.sales_date
from anta_daily.src_sales_history s
cross join target_has_rows thr
left join latest_sales_batch lsb
  on true
where not thr.has_rows
   or s.loaded_at = lsb.loaded_at;

delete from anta_daily.rpt_sales_sku_daily target
using pg_temp.tmp_sales_rebuild_scope scope
where target.sales_date = scope.sales_date;

with product_dim as (
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
    order by btrim(sku), source_file desc, loaded_at desc
),
sales_mapped as (
    select
        s.sales_date,
        btrim(s.sku) as sku,
        coalesce(nullif(btrim(m.sales_channel), ''), '其他') as sales_channel,
        sum(s.sales_qty) as net_sales_qty,
        sum(s.sales_amount) as net_sales_amount,
        sum(s.tag_amount) as net_tag_amount
    from anta_daily.src_sales_history s
    join pg_temp.tmp_sales_rebuild_scope scope
      on scope.sales_date = s.sales_date
    left join anta_daily.src_sales_channel_map m
      on btrim(m.store_name) = btrim(s.store_name)
    where s.doc_type in ('销售单', '退货单', '换货单')
    group by
        s.sales_date,
        btrim(s.sku),
        coalesce(nullif(btrim(m.sales_channel), ''), '其他')
),
sales_filtered as (
    select *
    from sales_mapped
    where sales_channel <> '删除'
),
sales_pivot as (
    select
        sales_date,
        sku,
        coalesce(sum(net_sales_qty) filter (where sales_channel = '女子'), 0) as sales_women_qty,
        coalesce(sum(net_sales_qty) filter (where sales_channel = '户外'), 0) as sales_outdoor_qty,
        coalesce(sum(net_sales_qty) filter (where sales_channel = '潮流'), 0) as sales_trend_qty,
        coalesce(sum(net_sales_qty) filter (where sales_channel = '休闲'), 0) as sales_casual_qty,
        coalesce(sum(net_sales_qty) filter (where sales_channel = '天猫羽球'), 0) as sales_tmall_badminton_qty,
        coalesce(sum(net_sales_qty) filter (where sales_channel = '天猫奥莱'), 0) as sales_tmall_outlet_qty,
        coalesce(sum(net_sales_qty) filter (where sales_channel = 'C店'), 0) as sales_c_store_qty,
        coalesce(sum(net_sales_qty) filter (where sales_channel = '奥莱安建立'), 0) as sales_outlet_anjianli_qty,
        coalesce(sum(net_sales_qty) filter (where sales_channel = '天猫旗舰'), 0) as sales_tmall_flagship_qty,
        coalesce(sum(net_sales_qty) filter (where sales_channel = '天猫专卖'), 0) as sales_tmall_franchise_qty,
        coalesce(sum(net_sales_qty) filter (where sales_channel = '上海专卖'), 0) as sales_shanghai_franchise_qty,
        coalesce(sum(net_sales_qty) filter (where sales_channel = '京东旗舰'), 0) as sales_jd_flagship_qty,
        coalesce(sum(net_sales_qty) filter (where sales_channel = '京东专卖'), 0) as sales_jd_franchise_qty,
        coalesce(sum(net_sales_qty) filter (where sales_channel = '京自营'), 0) as sales_jd_self_qty,
        coalesce(sum(net_sales_qty) filter (where sales_channel = '得物'), 0) as sales_dewu_qty,
        coalesce(sum(net_sales_qty) filter (where sales_channel = '唯品'), 0) as sales_vip_qty,
        coalesce(sum(net_sales_qty) filter (where sales_channel = '拼多多'), 0) as sales_pdd_qty,
        coalesce(sum(net_sales_qty) filter (where sales_channel = '兴趣'), 0) as sales_interest_qty,
        coalesce(sum(net_sales_qty) filter (where sales_channel = '官网'), 0) as sales_official_qty,
        coalesce(sum(net_sales_qty) filter (where sales_channel = '团购'), 0) as sales_group_buy_qty,
        coalesce(sum(net_sales_qty) filter (where sales_channel = '经销'), 0) as sales_distributor_qty,
        coalesce(sum(net_sales_qty) filter (where sales_channel = '其他'), 0) as sales_other_qty,
        coalesce(sum(net_sales_qty), 0) as sales_total_qty,
        coalesce(sum(net_sales_amount), 0) as sales_total_amount,
        coalesce(sum(net_tag_amount), 0) as sales_total_tag_amount
    from sales_filtered
    group by sales_date, sku
),
sku_discount_pivot as (
    select
        sales_date,
        sku,
        round(sum(net_sales_amount) filter (where sales_channel = '女子') / nullif(sum(net_tag_amount) filter (where sales_channel = '女子'), 0), 6) as sku_discount_women,
        round(sum(net_sales_amount) filter (where sales_channel = '户外') / nullif(sum(net_tag_amount) filter (where sales_channel = '户外'), 0), 6) as sku_discount_outdoor,
        round(sum(net_sales_amount) filter (where sales_channel = '潮流') / nullif(sum(net_tag_amount) filter (where sales_channel = '潮流'), 0), 6) as sku_discount_trend,
        round(sum(net_sales_amount) filter (where sales_channel = '休闲') / nullif(sum(net_tag_amount) filter (where sales_channel = '休闲'), 0), 6) as sku_discount_casual,
        round(sum(net_sales_amount) filter (where sales_channel = '天猫羽球') / nullif(sum(net_tag_amount) filter (where sales_channel = '天猫羽球'), 0), 6) as sku_discount_tmall_badminton,
        round(sum(net_sales_amount) filter (where sales_channel = '天猫奥莱') / nullif(sum(net_tag_amount) filter (where sales_channel = '天猫奥莱'), 0), 6) as sku_discount_tmall_outlet,
        round(sum(net_sales_amount) filter (where sales_channel = 'C店') / nullif(sum(net_tag_amount) filter (where sales_channel = 'C店'), 0), 6) as sku_discount_c_store,
        round(sum(net_sales_amount) filter (where sales_channel = '奥莱安建立') / nullif(sum(net_tag_amount) filter (where sales_channel = '奥莱安建立'), 0), 6) as sku_discount_outlet_anjianli,
        round(sum(net_sales_amount) filter (where sales_channel = '天猫旗舰') / nullif(sum(net_tag_amount) filter (where sales_channel = '天猫旗舰'), 0), 6) as sku_discount_tmall_flagship,
        round(sum(net_sales_amount) filter (where sales_channel = '天猫专卖') / nullif(sum(net_tag_amount) filter (where sales_channel = '天猫专卖'), 0), 6) as sku_discount_tmall_franchise,
        round(sum(net_sales_amount) filter (where sales_channel = '上海专卖') / nullif(sum(net_tag_amount) filter (where sales_channel = '上海专卖'), 0), 6) as sku_discount_shanghai_franchise,
        round(sum(net_sales_amount) filter (where sales_channel = '京东旗舰') / nullif(sum(net_tag_amount) filter (where sales_channel = '京东旗舰'), 0), 6) as sku_discount_jd_flagship,
        round(sum(net_sales_amount) filter (where sales_channel = '京东专卖') / nullif(sum(net_tag_amount) filter (where sales_channel = '京东专卖'), 0), 6) as sku_discount_jd_franchise,
        round(sum(net_sales_amount) filter (where sales_channel = '京自营') / nullif(sum(net_tag_amount) filter (where sales_channel = '京自营'), 0), 6) as sku_discount_jd_self,
        round(sum(net_sales_amount) filter (where sales_channel = '得物') / nullif(sum(net_tag_amount) filter (where sales_channel = '得物'), 0), 6) as sku_discount_dewu,
        round(sum(net_sales_amount) filter (where sales_channel = '唯品') / nullif(sum(net_tag_amount) filter (where sales_channel = '唯品'), 0), 6) as sku_discount_vip,
        round(sum(net_sales_amount) filter (where sales_channel = '拼多多') / nullif(sum(net_tag_amount) filter (where sales_channel = '拼多多'), 0), 6) as sku_discount_pdd,
        round(sum(net_sales_amount) filter (where sales_channel = '兴趣') / nullif(sum(net_tag_amount) filter (where sales_channel = '兴趣'), 0), 6) as sku_discount_interest,
        round(sum(net_sales_amount) filter (where sales_channel = '官网') / nullif(sum(net_tag_amount) filter (where sales_channel = '官网'), 0), 6) as sku_discount_official,
        round(sum(net_sales_amount) filter (where sales_channel = '团购') / nullif(sum(net_tag_amount) filter (where sales_channel = '团购'), 0), 6) as sku_discount_group_buy,
        round(sum(net_sales_amount) filter (where sales_channel = '经销') / nullif(sum(net_tag_amount) filter (where sales_channel = '经销'), 0), 6) as sku_discount_distributor,
        round(sum(net_sales_amount) filter (where sales_channel = '其他') / nullif(sum(net_tag_amount) filter (where sales_channel = '其他'), 0), 6) as sku_discount_other,
        round(sum(net_sales_amount) / nullif(sum(net_tag_amount), 0), 6) as sku_discount_total
    from sales_filtered
    group by sales_date, sku
),
style_channel_amounts as (
    select
        sf.sales_date,
        pd.style,
        sf.sales_channel,
        sum(sf.net_sales_amount) as net_sales_amount,
        sum(sf.net_tag_amount) as net_tag_amount
    from sales_filtered sf
    left join product_dim pd
      on pd.sku = sf.sku
    where pd.style is not null
    group by sf.sales_date, pd.style, sf.sales_channel
),
style_discount_pivot as (
    select
        sales_date,
        style,
        round(sum(net_sales_amount) filter (where sales_channel = '女子') / nullif(sum(net_tag_amount) filter (where sales_channel = '女子'), 0), 6) as style_discount_women,
        round(sum(net_sales_amount) filter (where sales_channel = '户外') / nullif(sum(net_tag_amount) filter (where sales_channel = '户外'), 0), 6) as style_discount_outdoor,
        round(sum(net_sales_amount) filter (where sales_channel = '潮流') / nullif(sum(net_tag_amount) filter (where sales_channel = '潮流'), 0), 6) as style_discount_trend,
        round(sum(net_sales_amount) filter (where sales_channel = '休闲') / nullif(sum(net_tag_amount) filter (where sales_channel = '休闲'), 0), 6) as style_discount_casual,
        round(sum(net_sales_amount) filter (where sales_channel = '天猫羽球') / nullif(sum(net_tag_amount) filter (where sales_channel = '天猫羽球'), 0), 6) as style_discount_tmall_badminton,
        round(sum(net_sales_amount) filter (where sales_channel = '天猫奥莱') / nullif(sum(net_tag_amount) filter (where sales_channel = '天猫奥莱'), 0), 6) as style_discount_tmall_outlet,
        round(sum(net_sales_amount) filter (where sales_channel = 'C店') / nullif(sum(net_tag_amount) filter (where sales_channel = 'C店'), 0), 6) as style_discount_c_store,
        round(sum(net_sales_amount) filter (where sales_channel = '奥莱安建立') / nullif(sum(net_tag_amount) filter (where sales_channel = '奥莱安建立'), 0), 6) as style_discount_outlet_anjianli,
        round(sum(net_sales_amount) filter (where sales_channel = '天猫旗舰') / nullif(sum(net_tag_amount) filter (where sales_channel = '天猫旗舰'), 0), 6) as style_discount_tmall_flagship,
        round(sum(net_sales_amount) filter (where sales_channel = '天猫专卖') / nullif(sum(net_tag_amount) filter (where sales_channel = '天猫专卖'), 0), 6) as style_discount_tmall_franchise,
        round(sum(net_sales_amount) filter (where sales_channel = '上海专卖') / nullif(sum(net_tag_amount) filter (where sales_channel = '上海专卖'), 0), 6) as style_discount_shanghai_franchise,
        round(sum(net_sales_amount) filter (where sales_channel = '京东旗舰') / nullif(sum(net_tag_amount) filter (where sales_channel = '京东旗舰'), 0), 6) as style_discount_jd_flagship,
        round(sum(net_sales_amount) filter (where sales_channel = '京东专卖') / nullif(sum(net_tag_amount) filter (where sales_channel = '京东专卖'), 0), 6) as style_discount_jd_franchise,
        round(sum(net_sales_amount) filter (where sales_channel = '京自营') / nullif(sum(net_tag_amount) filter (where sales_channel = '京自营'), 0), 6) as style_discount_jd_self,
        round(sum(net_sales_amount) filter (where sales_channel = '得物') / nullif(sum(net_tag_amount) filter (where sales_channel = '得物'), 0), 6) as style_discount_dewu,
        round(sum(net_sales_amount) filter (where sales_channel = '唯品') / nullif(sum(net_tag_amount) filter (where sales_channel = '唯品'), 0), 6) as style_discount_vip,
        round(sum(net_sales_amount) filter (where sales_channel = '拼多多') / nullif(sum(net_tag_amount) filter (where sales_channel = '拼多多'), 0), 6) as style_discount_pdd,
        round(sum(net_sales_amount) filter (where sales_channel = '兴趣') / nullif(sum(net_tag_amount) filter (where sales_channel = '兴趣'), 0), 6) as style_discount_interest,
        round(sum(net_sales_amount) filter (where sales_channel = '官网') / nullif(sum(net_tag_amount) filter (where sales_channel = '官网'), 0), 6) as style_discount_official,
        round(sum(net_sales_amount) filter (where sales_channel = '团购') / nullif(sum(net_tag_amount) filter (where sales_channel = '团购'), 0), 6) as style_discount_group_buy,
        round(sum(net_sales_amount) filter (where sales_channel = '经销') / nullif(sum(net_tag_amount) filter (where sales_channel = '经销'), 0), 6) as style_discount_distributor,
        round(sum(net_sales_amount) filter (where sales_channel = '其他') / nullif(sum(net_tag_amount) filter (where sales_channel = '其他'), 0), 6) as style_discount_other,
        round(sum(net_sales_amount) / nullif(sum(net_tag_amount), 0), 6) as style_discount_total
    from style_channel_amounts
    group by sales_date, style
)
insert into anta_daily.rpt_sales_sku_daily (
    sales_date, style, sku, major_category, category, product_name, tag_price, season, gender, story_pack,
    sales_women_qty, sales_outdoor_qty, sales_trend_qty, sales_casual_qty, sales_tmall_badminton_qty,
    sales_tmall_outlet_qty, sales_c_store_qty, sales_outlet_anjianli_qty, sales_tmall_flagship_qty,
    sales_tmall_franchise_qty, sales_shanghai_franchise_qty, sales_jd_flagship_qty, sales_jd_franchise_qty,
    sales_jd_self_qty, sales_dewu_qty, sales_vip_qty, sales_pdd_qty, sales_interest_qty, sales_official_qty,
    sales_group_buy_qty, sales_distributor_qty, sales_other_qty, sales_total_qty, sales_total_amount, sales_total_tag_amount,
    sku_discount_women, sku_discount_outdoor, sku_discount_trend, sku_discount_casual, sku_discount_tmall_badminton,
    sku_discount_tmall_outlet, sku_discount_c_store, sku_discount_outlet_anjianli, sku_discount_tmall_flagship,
    sku_discount_tmall_franchise, sku_discount_shanghai_franchise, sku_discount_jd_flagship, sku_discount_jd_franchise,
    sku_discount_jd_self, sku_discount_dewu, sku_discount_vip, sku_discount_pdd, sku_discount_interest,
    sku_discount_official, sku_discount_group_buy, sku_discount_distributor, sku_discount_other, sku_discount_total,
    style_discount_women, style_discount_outdoor, style_discount_trend, style_discount_casual,
    style_discount_tmall_badminton, style_discount_tmall_outlet, style_discount_c_store,
    style_discount_outlet_anjianli, style_discount_tmall_flagship, style_discount_tmall_franchise,
    style_discount_shanghai_franchise, style_discount_jd_flagship, style_discount_jd_franchise,
    style_discount_jd_self, style_discount_dewu, style_discount_vip, style_discount_pdd, style_discount_interest,
    style_discount_official, style_discount_group_buy, style_discount_distributor, style_discount_other,
    style_discount_total
)
select
    sp.sales_date,
    pd.style,
    sp.sku,
    pd.major_category,
    pd.category,
    pd.product_name,
    pd.tag_price,
    pd.season,
    pd.gender,
    pd.story_pack,
    coalesce(sp.sales_women_qty, 0), coalesce(sp.sales_outdoor_qty, 0), coalesce(sp.sales_trend_qty, 0),
    coalesce(sp.sales_casual_qty, 0), coalesce(sp.sales_tmall_badminton_qty, 0), coalesce(sp.sales_tmall_outlet_qty, 0),
    coalesce(sp.sales_c_store_qty, 0), coalesce(sp.sales_outlet_anjianli_qty, 0), coalesce(sp.sales_tmall_flagship_qty, 0),
    coalesce(sp.sales_tmall_franchise_qty, 0), coalesce(sp.sales_shanghai_franchise_qty, 0),
    coalesce(sp.sales_jd_flagship_qty, 0), coalesce(sp.sales_jd_franchise_qty, 0), coalesce(sp.sales_jd_self_qty, 0),
    coalesce(sp.sales_dewu_qty, 0), coalesce(sp.sales_vip_qty, 0), coalesce(sp.sales_pdd_qty, 0),
    coalesce(sp.sales_interest_qty, 0), coalesce(sp.sales_official_qty, 0), coalesce(sp.sales_group_buy_qty, 0),
    coalesce(sp.sales_distributor_qty, 0), coalesce(sp.sales_other_qty, 0), coalesce(sp.sales_total_qty, 0),
    coalesce(sp.sales_total_amount, 0), coalesce(sp.sales_total_tag_amount, 0),
    skd.sku_discount_women, skd.sku_discount_outdoor, skd.sku_discount_trend, skd.sku_discount_casual,
    skd.sku_discount_tmall_badminton, skd.sku_discount_tmall_outlet, skd.sku_discount_c_store,
    skd.sku_discount_outlet_anjianli, skd.sku_discount_tmall_flagship, skd.sku_discount_tmall_franchise,
    skd.sku_discount_shanghai_franchise, skd.sku_discount_jd_flagship, skd.sku_discount_jd_franchise,
    skd.sku_discount_jd_self, skd.sku_discount_dewu, skd.sku_discount_vip, skd.sku_discount_pdd,
    skd.sku_discount_interest, skd.sku_discount_official, skd.sku_discount_group_buy,
    skd.sku_discount_distributor, skd.sku_discount_other, skd.sku_discount_total,
    std.style_discount_women, std.style_discount_outdoor, std.style_discount_trend, std.style_discount_casual,
    std.style_discount_tmall_badminton, std.style_discount_tmall_outlet, std.style_discount_c_store,
    std.style_discount_outlet_anjianli, std.style_discount_tmall_flagship, std.style_discount_tmall_franchise,
    std.style_discount_shanghai_franchise, std.style_discount_jd_flagship, std.style_discount_jd_franchise,
    std.style_discount_jd_self, std.style_discount_dewu, std.style_discount_vip, std.style_discount_pdd,
    std.style_discount_interest, std.style_discount_official, std.style_discount_group_buy,
    std.style_discount_distributor, std.style_discount_other, std.style_discount_total
from sales_pivot sp
left join product_dim pd
  on pd.sku = sp.sku
left join sku_discount_pivot skd
  on skd.sales_date = sp.sales_date
 and skd.sku = sp.sku
left join style_discount_pivot std
  on std.sales_date = sp.sales_date
 and std.style = pd.style;

truncate table anta_daily.rpt_inventory_sku_latest;

with latest_inventory_date as (
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
    order by btrim(sku), source_file desc, loaded_at desc
),
inventory_mapped as (
    select
        i.snapshot_date,
        btrim(i.sku) as sku,
        coalesce(nullif(btrim(m.inventory_channel), ''), '其他') as inventory_channel,
        sum(i.available_qty) as qty
    from anta_daily.src_inventory_current i
    join latest_inventory_date lid
      on lid.snapshot_date = i.snapshot_date
    left join anta_daily.src_inventory_channel_map m
      on btrim(m.pool_name) = btrim(i.pool_name)
    group by
        i.snapshot_date,
        btrim(i.sku),
        coalesce(nullif(btrim(m.inventory_channel), ''), '其他')
),
inventory_filtered as (
    select *
    from inventory_mapped
    where inventory_channel <> '不可用'
),
inventory_pivot as (
    select
        sku,
        max(snapshot_date) as inventory_snapshot_date,
        coalesce(sum(qty) filter (where inventory_channel = '货通'), 0) as inv_huotong_qty,
        coalesce(sum(qty) filter (where inventory_channel = '女子'), 0) as inv_women_qty,
        coalesce(sum(qty) filter (where inventory_channel = '户外'), 0) as inv_outdoor_qty,
        coalesce(sum(qty) filter (where inventory_channel = '潮流'), 0) as inv_trend_qty,
        coalesce(sum(qty) filter (where inventory_channel = '休闲'), 0) as inv_casual_qty,
        coalesce(sum(qty) filter (where inventory_channel = 'C店'), 0) as inv_c_store_qty,
        coalesce(sum(qty) filter (where inventory_channel = '品类共享'), 0) as inv_category_shared_qty,
        coalesce(sum(qty) filter (where inventory_channel = '天猫奥莱'), 0) as inv_tmall_outlet_qty,
        coalesce(sum(qty) filter (where inventory_channel = '共享'), 0) as inv_shared_qty,
        coalesce(sum(qty) filter (where inventory_channel = '天猫旗舰'), 0) as inv_tmall_flagship_qty,
        coalesce(sum(qty) filter (where inventory_channel = '天猫专卖'), 0) as inv_tmall_franchise_qty,
        coalesce(sum(qty) filter (where inventory_channel = '上海专卖'), 0) as inv_shanghai_franchise_qty,
        coalesce(sum(qty) filter (where inventory_channel = '京东旗舰'), 0) as inv_jd_flagship_qty,
        coalesce(sum(qty) filter (where inventory_channel = '京东专卖'), 0) as inv_jd_franchise_qty,
        coalesce(sum(qty) filter (where inventory_channel = '京自营'), 0) as inv_jd_self_qty,
        coalesce(sum(qty) filter (where inventory_channel = '得物'), 0) as inv_dewu_qty,
        coalesce(sum(qty) filter (where inventory_channel = '兴趣'), 0) as inv_interest_qty,
        coalesce(sum(qty) filter (where inventory_channel = '唯品'), 0) as inv_vip_qty,
        coalesce(sum(qty) filter (where inventory_channel = '拼多多'), 0) as inv_pdd_qty,
        coalesce(sum(qty) filter (where inventory_channel = '经销'), 0) as inv_distributor_qty,
        coalesce(sum(qty) filter (where inventory_channel = '其他'), 0) as inv_other_qty,
        coalesce(sum(qty), 0) as inventory_total_qty
    from inventory_filtered
    group by sku
)
insert into anta_daily.rpt_inventory_sku_latest (
    inventory_snapshot_date, style, sku, major_category, category, product_name, tag_price, season, gender, story_pack,
    inv_huotong_qty, inv_women_qty, inv_outdoor_qty, inv_trend_qty, inv_casual_qty, inv_c_store_qty,
    inv_category_shared_qty, inv_tmall_outlet_qty, inv_shared_qty, inv_tmall_flagship_qty, inv_tmall_franchise_qty,
    inv_shanghai_franchise_qty, inv_jd_flagship_qty, inv_jd_franchise_qty, inv_jd_self_qty, inv_dewu_qty,
    inv_interest_qty, inv_vip_qty, inv_pdd_qty, inv_distributor_qty, inv_other_qty, inventory_total_qty
)
select
    ip.inventory_snapshot_date,
    pd.style,
    ip.sku,
    pd.major_category,
    pd.category,
    pd.product_name,
    pd.tag_price,
    pd.season,
    pd.gender,
    pd.story_pack,
    ip.inv_huotong_qty, ip.inv_women_qty, ip.inv_outdoor_qty, ip.inv_trend_qty, ip.inv_casual_qty, ip.inv_c_store_qty,
    ip.inv_category_shared_qty, ip.inv_tmall_outlet_qty, ip.inv_shared_qty, ip.inv_tmall_flagship_qty, ip.inv_tmall_franchise_qty,
    ip.inv_shanghai_franchise_qty, ip.inv_jd_flagship_qty, ip.inv_jd_franchise_qty, ip.inv_jd_self_qty, ip.inv_dewu_qty,
    ip.inv_interest_qty, ip.inv_vip_qty, ip.inv_pdd_qty, ip.inv_distributor_qty, ip.inv_other_qty, ip.inventory_total_qty
from inventory_pivot ip
left join product_dim pd
  on pd.sku = ip.sku
where coalesce(ip.inventory_total_qty, 0) <> 0;

commit;
