\set ON_ERROR_STOP on
\encoding UTF8

drop table if exists pg_temp.tmp_src_sales_history;
create temporary table pg_temp.tmp_src_sales_history (
    sales_date date not null,
    doc_type text not null,
    store_name text not null,
    sku text not null,
    sales_qty numeric(18,2) not null,
    sales_amount numeric(18,2) not null,
    tag_amount numeric(18,2) not null,
    source_file text not null
);

\copy pg_temp.tmp_src_sales_history (sales_date, doc_type, store_name, sku, sales_qty, sales_amount, tag_amount, source_file) from '../../data/prepared/sales_history.csv' with (format csv, header true, encoding 'UTF8')

begin;

delete from anta_daily.src_sales_history target
using (
    select distinct sales_date
    from pg_temp.tmp_src_sales_history
) incoming
where target.sales_date = incoming.sales_date;

insert into anta_daily.src_sales_history (
    sales_date,
    doc_type,
    store_name,
    sku,
    sales_qty,
    sales_amount,
    tag_amount,
    source_file
)
select
    sales_date,
    doc_type,
    store_name,
    sku,
    sales_qty,
    sales_amount,
    tag_amount,
    source_file
from pg_temp.tmp_src_sales_history;

commit;

analyze anta_daily.src_sales_history;
