IF OBJECT_ID(N'dbo.stg_stock_daily', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.stg_stock_daily (
        report_week DATE NOT NULL,
        pool_name NVARCHAR(200) NOT NULL,
        sku NVARCHAR(64) NOT NULL,
        size_name NVARCHAR(64) NULL,
        available_qty DECIMAL(18,4) NOT NULL DEFAULT (0),
        source_file NVARCHAR(260) NULL,
        loaded_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_stg_stock_week_sku ON dbo.stg_stock_daily(report_week, sku);
END;

IF OBJECT_ID(N'dbo.stg_pool_stock_daily', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.stg_pool_stock_daily (
        report_week DATE NOT NULL,
        pool_name NVARCHAR(200) NOT NULL,
        sku NVARCHAR(64) NOT NULL,
        available_qty DECIMAL(18,4) NOT NULL DEFAULT (0),
        source_file NVARCHAR(260) NULL,
        loaded_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_stg_pool_week_sku ON dbo.stg_pool_stock_daily(report_week, sku);
END;

IF OBJECT_ID(N'dbo.stg_sales_daily', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.stg_sales_daily (
        report_week DATE NOT NULL,
        settlement_date DATE NULL,
        doc_type NVARCHAR(64) NULL,
        store_name NVARCHAR(200) NULL,
        sku NVARCHAR(64) NOT NULL,
        sales_qty DECIMAL(18,4) NOT NULL DEFAULT (0),
        sales_amt DECIMAL(18,4) NOT NULL DEFAULT (0),
        tag_amt DECIMAL(18,4) NOT NULL DEFAULT (0),
        source_file NVARCHAR(260) NULL,
        loaded_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_stg_sales_week_sku ON dbo.stg_sales_daily(report_week, sku);
    CREATE INDEX IX_stg_sales_week_store ON dbo.stg_sales_daily(report_week, store_name);
END;

IF OBJECT_ID(N'dbo.stg_product_info', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.stg_product_info (
        report_week DATE NOT NULL,
        sku NVARCHAR(64) NOT NULL,
        style NVARCHAR(64) NULL,
        major_category NVARCHAR(64) NULL,
        category NVARCHAR(64) NULL,
        product_name NVARCHAR(256) NULL,
        tag_price DECIMAL(18,4) NULL,
        season NVARCHAR(32) NULL,
        gender NVARCHAR(32) NULL,
        story_pack NVARCHAR(128) NULL,
        color NVARCHAR(64) NULL,
        source_sheet NVARCHAR(128) NULL,
        source_file NVARCHAR(260) NULL,
        loaded_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_stg_product_week_sku ON dbo.stg_product_info(report_week, sku);
END;

IF OBJECT_ID(N'dbo.dim_pool_channel', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.dim_pool_channel (
        pool_name NVARCHAR(200) NOT NULL PRIMARY KEY,
        channel NVARCHAR(64) NOT NULL,
        remark NVARCHAR(128) NULL,
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END;

IF OBJECT_ID(N'dbo.dim_store_channel', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.dim_store_channel (
        store_name NVARCHAR(200) NOT NULL PRIMARY KEY,
        channel NVARCHAR(64) NOT NULL,
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END;

IF OBJECT_ID(N'dbo.dim_pool_ratio', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.dim_pool_ratio (
        pool_name NVARCHAR(200) NOT NULL PRIMARY KEY,
        sync_ratio DECIMAL(18,6) NOT NULL,
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END;

IF OBJECT_ID(N'dbo.rpt_core_weekly_snapshot', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.rpt_core_weekly_snapshot (
        report_week DATE NOT NULL,
        sku NVARCHAR(64) NOT NULL,
        style NVARCHAR(64) NULL,
        major_category NVARCHAR(64) NULL,
        category NVARCHAR(64) NULL,
        product_name NVARCHAR(256) NULL,
        tag_price DECIMAL(18,4) NULL,
        season NVARCHAR(32) NULL,
        gender NVARCHAR(32) NULL,
        story_pack NVARCHAR(128) NULL,
        color NVARCHAR(64) NULL,
        category_exclusive_qty DECIMAL(18,4) NOT NULL DEFAULT (0),
        category_available_qty DECIMAL(18,4) NOT NULL DEFAULT (0),
        pool_sync_qty DECIMAL(18,4) NOT NULL DEFAULT (0),
        olai_sync_qty DECIMAL(18,4) NOT NULL DEFAULT (0),
        full_stock_qty DECIMAL(18,4) NOT NULL DEFAULT (0),
        ecommerce_sales_qty DECIMAL(18,4) NOT NULL DEFAULT (0),
        sales_amt_total DECIMAL(18,4) NOT NULL DEFAULT (0),
        tag_amt_total DECIMAL(18,4) NOT NULL DEFAULT (0),
        sku_discount DECIMAL(18,6) NOT NULL DEFAULT (0),
        style_discount DECIMAL(18,6) NOT NULL DEFAULT (0),
        inventory_json NVARCHAR(MAX) NULL,
        sales_json NVARCHAR(MAX) NULL,
        sku_discount_json NVARCHAR(MAX) NULL,
        style_discount_json NVARCHAR(MAX) NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_rpt_core_weekly_snapshot PRIMARY KEY (report_week, sku)
    );
    CREATE INDEX IX_rpt_core_weekly_snapshot_week_style ON dbo.rpt_core_weekly_snapshot(report_week, style);
END;

IF COL_LENGTH(N'dbo.rpt_core_weekly_snapshot', N'sku_discount_json') IS NULL
BEGIN
    ALTER TABLE dbo.rpt_core_weekly_snapshot ADD sku_discount_json NVARCHAR(MAX) NULL;
END;

IF COL_LENGTH(N'dbo.rpt_core_weekly_snapshot', N'style_discount_json') IS NULL
BEGIN
    ALTER TABLE dbo.rpt_core_weekly_snapshot ADD style_discount_json NVARCHAR(MAX) NULL;
END;

IF OBJECT_ID(N'dbo.rpt_core_weekly_meta', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.rpt_core_weekly_meta (
        report_week DATE NOT NULL PRIMARY KEY,
        stock_group_label NVARCHAR(64) NOT NULL DEFAULT (N'可用库存'),
        sales_qty_group_label NVARCHAR(64) NOT NULL DEFAULT (N'销售数量'),
        sku_discount_group_label NVARCHAR(64) NOT NULL DEFAULT (N'销售折扣'),
        style_discount_group_label NVARCHAR(64) NOT NULL DEFAULT (N'销售折扣'),
        sales_date_from DATE NULL,
        sales_date_to DATE NULL,
        row_count INT NOT NULL DEFAULT (0),
        missing_store_channel_count INT NOT NULL DEFAULT (0),
        missing_pool_channel_count INT NOT NULL DEFAULT (0),
        missing_pool_ratio_count INT NOT NULL DEFAULT (0),
        unknown_inventory_channel_count INT NOT NULL DEFAULT (0),
        unknown_sales_channel_count INT NOT NULL DEFAULT (0),
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END;

IF COL_LENGTH(N'dbo.rpt_core_weekly_meta', N'missing_store_channel_count') IS NULL
BEGIN
    ALTER TABLE dbo.rpt_core_weekly_meta ADD missing_store_channel_count INT NOT NULL DEFAULT (0);
END;

IF COL_LENGTH(N'dbo.rpt_core_weekly_meta', N'missing_pool_channel_count') IS NULL
BEGIN
    ALTER TABLE dbo.rpt_core_weekly_meta ADD missing_pool_channel_count INT NOT NULL DEFAULT (0);
END;

IF COL_LENGTH(N'dbo.rpt_core_weekly_meta', N'missing_pool_ratio_count') IS NULL
BEGIN
    ALTER TABLE dbo.rpt_core_weekly_meta ADD missing_pool_ratio_count INT NOT NULL DEFAULT (0);
END;

IF COL_LENGTH(N'dbo.rpt_core_weekly_meta', N'unknown_inventory_channel_count') IS NULL
BEGIN
    ALTER TABLE dbo.rpt_core_weekly_meta ADD unknown_inventory_channel_count INT NOT NULL DEFAULT (0);
END;

IF COL_LENGTH(N'dbo.rpt_core_weekly_meta', N'unknown_sales_channel_count') IS NULL
BEGIN
    ALTER TABLE dbo.rpt_core_weekly_meta ADD unknown_sales_channel_count INT NOT NULL DEFAULT (0);
END;

IF OBJECT_ID(N'dbo.rpt_core_weekly_agg', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.rpt_core_weekly_agg (
        report_week DATE NOT NULL,
        season NVARCHAR(32) NOT NULL,
        gender NVARCHAR(32) NOT NULL,
        category NVARCHAR(64) NOT NULL,
        style NVARCHAR(64) NOT NULL,
        sku_count INT NOT NULL DEFAULT (0),
        arrived_sku_count INT NOT NULL DEFAULT (0),
        stock_qty_total DECIMAL(18,4) NOT NULL DEFAULT (0),
        sales_qty_total DECIMAL(18,4) NOT NULL DEFAULT (0),
        sales_amt_total DECIMAL(18,4) NOT NULL DEFAULT (0),
        tag_amt_total DECIMAL(18,4) NOT NULL DEFAULT (0),
        discount_ratio DECIMAL(18,6) NOT NULL DEFAULT (0),
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_rpt_core_weekly_agg PRIMARY KEY (report_week, season, gender, category, style)
    );
END;

IF OBJECT_ID(N'dbo.stg_sales_day', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.stg_sales_day (
        sales_date DATE NOT NULL,
        settlement_date DATE NULL,
        doc_type NVARCHAR(64) NULL,
        store_name NVARCHAR(200) NULL,
        sku NVARCHAR(64) NOT NULL,
        sales_qty DECIMAL(18,4) NOT NULL DEFAULT (0),
        sales_amt DECIMAL(18,4) NOT NULL DEFAULT (0),
        tag_amt DECIMAL(18,4) NOT NULL DEFAULT (0),
        source_file NVARCHAR(260) NULL,
        loaded_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.stg_sales_day')
      AND name = N'IX_stg_sales_day_date_sku'
)
BEGIN
    CREATE INDEX IX_stg_sales_day_date_sku ON dbo.stg_sales_day(sales_date, sku);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.stg_sales_day')
      AND name = N'IX_stg_sales_day_date_store'
)
BEGIN
    CREATE INDEX IX_stg_sales_day_date_store ON dbo.stg_sales_day(sales_date, store_name);
END;

IF OBJECT_ID(N'dbo.stg_inventory_latest', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.stg_inventory_latest (
        inventory_date DATE NOT NULL,
        pool_name NVARCHAR(200) NOT NULL,
        sku NVARCHAR(64) NOT NULL,
        size_name NVARCHAR(64) NULL,
        available_qty DECIMAL(18,4) NOT NULL DEFAULT (0),
        source_file NVARCHAR(260) NULL,
        loaded_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.stg_inventory_latest')
      AND name = N'IX_stg_inventory_latest_date_sku'
)
BEGIN
    CREATE INDEX IX_stg_inventory_latest_date_sku ON dbo.stg_inventory_latest(inventory_date, sku);
END;

IF OBJECT_ID(N'dbo.rpt_daily_sku_wide_hot', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.rpt_daily_sku_wide_hot (
        sales_date DATE NOT NULL,
        sku NVARCHAR(64) NOT NULL,
        inventory_date DATE NOT NULL,
        style NVARCHAR(64) NULL,
        major_category NVARCHAR(64) NULL,
        category NVARCHAR(64) NULL,
        product_name NVARCHAR(256) NULL,
        tag_price DECIMAL(18,4) NULL,
        season NVARCHAR(32) NULL,
        gender NVARCHAR(32) NULL,
        story_pack NVARCHAR(128) NULL,
        color NVARCHAR(64) NULL,
        category_exclusive_qty DECIMAL(18,4) NOT NULL DEFAULT (0),
        category_available_qty DECIMAL(18,4) NOT NULL DEFAULT (0),
        pool_sync_qty DECIMAL(18,4) NOT NULL DEFAULT (0),
        olai_sync_qty DECIMAL(18,4) NOT NULL DEFAULT (0),
        full_stock_qty DECIMAL(18,4) NOT NULL DEFAULT (0),
        ecommerce_sales_qty DECIMAL(18,4) NOT NULL DEFAULT (0),
        sales_amt_total DECIMAL(18,4) NOT NULL DEFAULT (0),
        tag_amt_total DECIMAL(18,4) NOT NULL DEFAULT (0),
        sku_discount DECIMAL(18,6) NOT NULL DEFAULT (0),
        style_discount DECIMAL(18,6) NOT NULL DEFAULT (0),
        inventory_json NVARCHAR(MAX) NULL,
        sales_json NVARCHAR(MAX) NULL,
        sku_discount_json NVARCHAR(MAX) NULL,
        style_discount_json NVARCHAR(MAX) NULL,
        promo_impressions DECIMAL(18,4) NOT NULL DEFAULT (0),
        promo_clicks DECIMAL(18,4) NOT NULL DEFAULT (0),
        promo_spend DECIMAL(18,4) NOT NULL DEFAULT (0),
        promo_gmv DECIMAL(18,4) NOT NULL DEFAULT (0),
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_rpt_daily_sku_wide_hot PRIMARY KEY (sales_date, sku)
    );
END;

IF COL_LENGTH(N'dbo.rpt_daily_sku_wide_hot', N'inventory_date') IS NULL
BEGIN
    ALTER TABLE dbo.rpt_daily_sku_wide_hot ADD inventory_date DATE NOT NULL DEFAULT ('1900-01-01');
END;

IF COL_LENGTH(N'dbo.rpt_daily_sku_wide_hot', N'sku_discount_json') IS NULL
BEGIN
    ALTER TABLE dbo.rpt_daily_sku_wide_hot ADD sku_discount_json NVARCHAR(MAX) NULL;
END;

IF COL_LENGTH(N'dbo.rpt_daily_sku_wide_hot', N'style_discount_json') IS NULL
BEGIN
    ALTER TABLE dbo.rpt_daily_sku_wide_hot ADD style_discount_json NVARCHAR(MAX) NULL;
END;

IF COL_LENGTH(N'dbo.rpt_daily_sku_wide_hot', N'promo_impressions') IS NULL
BEGIN
    ALTER TABLE dbo.rpt_daily_sku_wide_hot ADD promo_impressions DECIMAL(18,4) NOT NULL DEFAULT (0);
END;

IF COL_LENGTH(N'dbo.rpt_daily_sku_wide_hot', N'promo_clicks') IS NULL
BEGIN
    ALTER TABLE dbo.rpt_daily_sku_wide_hot ADD promo_clicks DECIMAL(18,4) NOT NULL DEFAULT (0);
END;

IF COL_LENGTH(N'dbo.rpt_daily_sku_wide_hot', N'promo_spend') IS NULL
BEGIN
    ALTER TABLE dbo.rpt_daily_sku_wide_hot ADD promo_spend DECIMAL(18,4) NOT NULL DEFAULT (0);
END;

IF COL_LENGTH(N'dbo.rpt_daily_sku_wide_hot', N'promo_gmv') IS NULL
BEGIN
    ALTER TABLE dbo.rpt_daily_sku_wide_hot ADD promo_gmv DECIMAL(18,4) NOT NULL DEFAULT (0);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.rpt_daily_sku_wide_hot')
      AND name = N'IX_rpt_daily_hot_week_style'
)
BEGIN
    CREATE INDEX IX_rpt_daily_hot_week_style ON dbo.rpt_daily_sku_wide_hot(sales_date, style);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.rpt_daily_sku_wide_hot')
      AND name = N'IX_rpt_daily_hot_sku_date'
)
BEGIN
    CREATE INDEX IX_rpt_daily_hot_sku_date ON dbo.rpt_daily_sku_wide_hot(sku, sales_date DESC);
END;

IF OBJECT_ID(N'dbo.rpt_daily_sku_wide_archive', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.rpt_daily_sku_wide_archive (
        sales_date DATE NOT NULL,
        sku NVARCHAR(64) NOT NULL,
        inventory_date DATE NOT NULL,
        style NVARCHAR(64) NULL,
        major_category NVARCHAR(64) NULL,
        category NVARCHAR(64) NULL,
        product_name NVARCHAR(256) NULL,
        tag_price DECIMAL(18,4) NULL,
        season NVARCHAR(32) NULL,
        gender NVARCHAR(32) NULL,
        story_pack NVARCHAR(128) NULL,
        color NVARCHAR(64) NULL,
        category_exclusive_qty DECIMAL(18,4) NOT NULL DEFAULT (0),
        category_available_qty DECIMAL(18,4) NOT NULL DEFAULT (0),
        pool_sync_qty DECIMAL(18,4) NOT NULL DEFAULT (0),
        olai_sync_qty DECIMAL(18,4) NOT NULL DEFAULT (0),
        full_stock_qty DECIMAL(18,4) NOT NULL DEFAULT (0),
        ecommerce_sales_qty DECIMAL(18,4) NOT NULL DEFAULT (0),
        sales_amt_total DECIMAL(18,4) NOT NULL DEFAULT (0),
        tag_amt_total DECIMAL(18,4) NOT NULL DEFAULT (0),
        sku_discount DECIMAL(18,6) NOT NULL DEFAULT (0),
        style_discount DECIMAL(18,6) NOT NULL DEFAULT (0),
        inventory_json NVARCHAR(MAX) NULL,
        sales_json NVARCHAR(MAX) NULL,
        sku_discount_json NVARCHAR(MAX) NULL,
        style_discount_json NVARCHAR(MAX) NULL,
        promo_impressions DECIMAL(18,4) NOT NULL DEFAULT (0),
        promo_clicks DECIMAL(18,4) NOT NULL DEFAULT (0),
        promo_spend DECIMAL(18,4) NOT NULL DEFAULT (0),
        promo_gmv DECIMAL(18,4) NOT NULL DEFAULT (0),
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_rpt_daily_sku_wide_archive PRIMARY KEY (sales_date, sku)
    );
END;

IF COL_LENGTH(N'dbo.rpt_daily_sku_wide_archive', N'inventory_date') IS NULL
BEGIN
    ALTER TABLE dbo.rpt_daily_sku_wide_archive ADD inventory_date DATE NOT NULL DEFAULT ('1900-01-01');
END;

IF COL_LENGTH(N'dbo.rpt_daily_sku_wide_archive', N'sku_discount_json') IS NULL
BEGIN
    ALTER TABLE dbo.rpt_daily_sku_wide_archive ADD sku_discount_json NVARCHAR(MAX) NULL;
END;

IF COL_LENGTH(N'dbo.rpt_daily_sku_wide_archive', N'style_discount_json') IS NULL
BEGIN
    ALTER TABLE dbo.rpt_daily_sku_wide_archive ADD style_discount_json NVARCHAR(MAX) NULL;
END;

IF COL_LENGTH(N'dbo.rpt_daily_sku_wide_archive', N'promo_impressions') IS NULL
BEGIN
    ALTER TABLE dbo.rpt_daily_sku_wide_archive ADD promo_impressions DECIMAL(18,4) NOT NULL DEFAULT (0);
END;

IF COL_LENGTH(N'dbo.rpt_daily_sku_wide_archive', N'promo_clicks') IS NULL
BEGIN
    ALTER TABLE dbo.rpt_daily_sku_wide_archive ADD promo_clicks DECIMAL(18,4) NOT NULL DEFAULT (0);
END;

IF COL_LENGTH(N'dbo.rpt_daily_sku_wide_archive', N'promo_spend') IS NULL
BEGIN
    ALTER TABLE dbo.rpt_daily_sku_wide_archive ADD promo_spend DECIMAL(18,4) NOT NULL DEFAULT (0);
END;

IF COL_LENGTH(N'dbo.rpt_daily_sku_wide_archive', N'promo_gmv') IS NULL
BEGIN
    ALTER TABLE dbo.rpt_daily_sku_wide_archive ADD promo_gmv DECIMAL(18,4) NOT NULL DEFAULT (0);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.rpt_daily_sku_wide_archive')
      AND name = N'IX_rpt_daily_archive_week_style'
)
BEGIN
    CREATE INDEX IX_rpt_daily_archive_week_style ON dbo.rpt_daily_sku_wide_archive(sales_date, style);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.rpt_daily_sku_wide_archive')
      AND name = N'IX_rpt_daily_archive_sku_date'
)
BEGIN
    CREATE INDEX IX_rpt_daily_archive_sku_date ON dbo.rpt_daily_sku_wide_archive(sku, sales_date DESC);
END;

IF OBJECT_ID(N'dbo.rpt_daily_meta', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.rpt_daily_meta (
        sales_date DATE NOT NULL PRIMARY KEY,
        inventory_date DATE NOT NULL,
        stock_group_label NVARCHAR(64) NOT NULL DEFAULT (N'可用库存'),
        sales_qty_group_label NVARCHAR(64) NOT NULL DEFAULT (N'销售数量'),
        sku_discount_group_label NVARCHAR(64) NOT NULL DEFAULT (N'销售折扣'),
        style_discount_group_label NVARCHAR(64) NOT NULL DEFAULT (N'销售折扣'),
        row_count INT NOT NULL DEFAULT (0),
        missing_store_channel_count INT NOT NULL DEFAULT (0),
        missing_pool_channel_count INT NOT NULL DEFAULT (0),
        missing_pool_ratio_count INT NOT NULL DEFAULT (0),
        unknown_inventory_channel_count INT NOT NULL DEFAULT (0),
        unknown_sales_channel_count INT NOT NULL DEFAULT (0),
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END;

IF COL_LENGTH(N'dbo.rpt_daily_meta', N'inventory_date') IS NULL
BEGIN
    ALTER TABLE dbo.rpt_daily_meta ADD inventory_date DATE NOT NULL DEFAULT ('1900-01-01');
END;

IF OBJECT_ID(N'dbo.v_rpt_daily_sku_wide_all', N'V') IS NULL
BEGIN
    EXEC(N'
        CREATE VIEW dbo.v_rpt_daily_sku_wide_all
        AS
        SELECT
            sales_date, sku, inventory_date, style, major_category, category, product_name, tag_price,
            season, gender, story_pack, color,
            category_exclusive_qty, category_available_qty, pool_sync_qty, olai_sync_qty,
            full_stock_qty, ecommerce_sales_qty, sales_amt_total, tag_amt_total,
            sku_discount, style_discount, inventory_json, sales_json, sku_discount_json, style_discount_json,
            promo_impressions, promo_clicks, promo_spend, promo_gmv, created_at
        FROM dbo.rpt_daily_sku_wide_hot
    ');
END;

EXEC(N'
ALTER VIEW dbo.v_rpt_daily_sku_wide_all
AS
SELECT
    sales_date, sku, inventory_date, style, major_category, category, product_name, tag_price,
    season, gender, story_pack, color,
    category_exclusive_qty, category_available_qty, pool_sync_qty, olai_sync_qty,
    full_stock_qty, ecommerce_sales_qty, sales_amt_total, tag_amt_total,
    sku_discount, style_discount, inventory_json, sales_json, sku_discount_json, style_discount_json,
    promo_impressions, promo_clicks, promo_spend, promo_gmv, created_at
FROM dbo.rpt_daily_sku_wide_hot
UNION ALL
SELECT
    sales_date, sku, inventory_date, style, major_category, category, product_name, tag_price,
    season, gender, story_pack, color,
    category_exclusive_qty, category_available_qty, pool_sync_qty, olai_sync_qty,
    full_stock_qty, ecommerce_sales_qty, sales_amt_total, tag_amt_total,
    sku_discount, style_discount, inventory_json, sales_json, sku_discount_json, style_discount_json,
    promo_impressions, promo_clicks, promo_spend, promo_gmv, created_at
FROM dbo.rpt_daily_sku_wide_archive;
');

IF OBJECT_ID(N'dbo.etl_run_log', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.etl_run_log (
        id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        run_id NVARCHAR(32) NOT NULL,
        log_time DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        level NVARCHAR(16) NOT NULL,
        step NVARCHAR(64) NOT NULL,
        message NVARCHAR(1000) NOT NULL,
        extra_json NVARCHAR(MAX) NULL
    );
    CREATE INDEX IX_etl_run_log_run_id ON dbo.etl_run_log(run_id, log_time);
END;
