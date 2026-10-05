CREATE TABLE [dbo].[criteria] (
  [id] int IDENTITY(1,1) NOT NULL,
  [is_usable_prioritization] nvarchar(255) NULL,
  [id_type] int NULL,
  [id_nature] int NULL,
  PRIMARY KEY ([id])
);

CREATE TABLE [dbo].[criteria_hyperparameter_qualitative] (
  [id] int IDENTITY(1,1) NOT NULL,
  [id_criteria_source] int NULL,
  [id_criteria_target] int NULL,
  PRIMARY KEY ([id])
);

CREATE TABLE [dbo].[criteria_hyperparameter_quantitative] (
  [id] int IDENTITY(1,1) NOT NULL,
  [description] nvarchar(255) NULL,
  [id_group_criteria_target] int NULL,
  [id_group_criteria_source] int NULL,
  [id_model] int NULL,
  PRIMARY KEY ([id])
);

CREATE TABLE [dbo].[criteria_nature] (
  [id] int IDENTITY(1,1) NOT NULL,
  [name] nvarchar(255) NULL,
  PRIMARY KEY ([id])
);

CREATE TABLE [dbo].[criteria_theme_list] (
  [id_theme] int NOT NULL,
  [id_criteria] int NOT NULL,
  PRIMARY KEY ([id_theme], [id_criteria])
);

CREATE TABLE [dbo].[criteria_translation] (
  [id] int IDENTITY(1,1) NOT NULL,
  [name] nvarchar(255) NULL,
  [description] nvarchar(255) NULL,
  [short_label] nvarchar(255) NULL,
  [id_language] int NULL,
  [id_criteria] int NULL,
  PRIMARY KEY ([id])
);

CREATE TABLE [dbo].[criteria_type] (
  [id] int IDENTITY(1,1) NOT NULL,
  [name] nvarchar(150) NULL,
  PRIMARY KEY ([id])
);

CREATE TABLE [dbo].[DbtQueryLog] (
  [log_id] int IDENTITY(1,1) NOT NULL,
  [model_name] nvarchar(255) NOT NULL,
  [session_id] int NULL,
  [request_id] int NULL,
  [database_name] nvarchar(128) NULL,
  [start_time] datetime NULL,
  [end_time] datetime NULL,
  [duration_sec] decimal(18,6) NULL,
  [duration_ms] decimal(18,3) NULL,
  [cpu_sec] decimal(18,6) NULL,
  [cpu_ms] decimal(18,3) NULL,
  [wait_sec] decimal(18,6) NULL,
  [wait_ms] decimal(18,3) NULL,
  [requested_memory_MB] decimal(18,2) NULL,
  [granted_memory_MB] decimal(18,2) NULL,
  [used_memory_MB] decimal(18,2) NULL,
  [max_used_memory_MB] decimal(18,2) NULL,
  [requested_memory_GB] decimal(18,4) NULL,
  [granted_memory_GB] decimal(18,4) NULL,
  [used_memory_GB] decimal(18,4) NULL,
  [max_used_memory_GB] decimal(18,4) NULL,
  [degree_of_parallelism] int NULL,
  [wait_type] nvarchar(60) NULL,
  [blocking_session_id] int NULL,
  [tempdb_user_MB] decimal(18,2) NULL,
  [tempdb_internal_MB] decimal(18,2) NULL,
  [logical_reads] bigint NULL,
  [writes] bigint NULL,
  [row_count] bigint NULL,
  [query_status] nvarchar(50) NULL,
  [command_type] nvarchar(50) NULL,
  [query_text] nvarchar(MAX) NULL,
  [created_date] datetime NULL,
  PRIMARY KEY ([log_id])
);

CREATE TABLE [dbo].[group_criteria] (
  [id] int IDENTITY(1,1) NOT NULL,
  [name] int NULL,
  PRIMARY KEY ([id])
);

CREATE TABLE [dbo].[group_criteria_list] (
  [id_group_criteria] int NOT NULL,
  [id_criteria] int NOT NULL,
  PRIMARY KEY ([id_group_criteria], [id_criteria])
);

CREATE TABLE [dbo].[hyperparameter] (
  [id] int IDENTITY(1,1) NOT NULL,
  [class_name] nvarchar(150) NULL,
  PRIMARY KEY ([id])
);

CREATE TABLE [dbo].[hyperparameter_qualitative_list] (
  [id_hyperparameter] int NOT NULL,
  [id_criteria_hyperparameter_qualitative] int NOT NULL,
  [inferior_threshold] decimal(18,6) NULL,
  [superior_threshold] decimal(18,6) NULL,
  PRIMARY KEY ([id_hyperparameter], [id_criteria_hyperparameter_qualitative])
);

CREATE TABLE [dbo].[hyperparameter_quantitative] (
  [id] int IDENTITY(1,1) NOT NULL,
  [name] nvarchar(255) NULL,
  PRIMARY KEY ([id])
);

CREATE TABLE [dbo].[hyperparameter_quantitative_list] (
  [id_hyperparameter_quantitative] int NOT NULL,
  [id_criteria_hyperparameter_quantitative] int NOT NULL,
  [value_dec] decimal(18,0) NULL,
  [value_varchar] nvarchar(255) NULL,
  PRIMARY KEY ([id_hyperparameter_quantitative], [id_criteria_hyperparameter_quantitative])
);

CREATE TABLE [dbo].[model] (
  [id] int IDENTITY(1,1) NOT NULL,
  [name] nvarchar(150) NULL,
  [number_input_criteria] int NULL,
  [number_output_criteria] int NULL,
  PRIMARY KEY ([id])
);

CREATE TABLE [dbo].[PAR01] (
  [month] varchar(3) NULL,
  [active] int NULL,
  [creator] nvarchar(150) NULL,
  [tracker_id] int NULL,
  [last_updated_date] datetime NOT NULL
);

CREATE TABLE [dbo].[PAR02] (
  [month] varchar(3) NULL,
  [active] int NULL,
  [id_trackers_package] int NULL,
  [tracker_id] int NULL,
  [last_updated_date] datetime NOT NULL
);

CREATE TABLE [dbo].[PAR03] (
  [creator] nvarchar(150) NULL,
  [description] nvarchar(MAX) NULL,
  [dimension_id] int NULL,
  [id_trackers_package] int NULL,
  [parameter] nvarchar(150) NULL,
  [tag] nvarchar(150) NULL,
  [threshold_value] nvarchar(150) NULL,
  [last_updated_date] datetime NOT NULL
);

CREATE TABLE [dbo].[PAR04] (
  [group_id] bigint NULL,
  [perimeter_id] bigint NULL,
  [year] bigint NULL,
  [month] varchar(MAX) NULL
);

CREATE TABLE [dbo].[PAR05] (
  [creator] nvarchar(150) NULL,
  [default_indicator] int NULL,
  [description] nvarchar(MAX) NULL,
  [dimension_id] int NULL,
  [parameter] nvarchar(150) NULL,
  [ref_perimeter_id] int NULL,
  [scenario_id] int NULL,
  [tag] nvarchar(150) NULL,
  [threshold_set_id] int NULL,
  [threshold_type] nvarchar(150) NULL,
  [threshold_value] nvarchar(150) NULL,
  [last_updated_date] datetime NOT NULL
);

CREATE TABLE [dbo].[PAR06] (
  [filter_value] nvarchar(150) NULL,
  [id_filter] int NULL,
  [indicator_id] int NULL,
  [operator] nvarchar(150) NULL,
  [rule_id] int NULL,
  [scenario_id] int NULL,
  [tracker_id] int NULL,
  [last_updated_date] datetime NOT NULL
);

CREATE TABLE [dbo].[PAR06_bis] (
  [filter_value] nvarchar(150) NULL,
  [id_filter] int NULL,
  [indicator_id] int NULL,
  [operator] nvarchar(150) NULL,
  [rule_id] int NULL,
  [scenario_id] int NULL,
  [tracker_id] int NULL,
  [last_updated_date] datetime NOT NULL
);

CREATE TABLE [dbo].[PAR07] (
  [id_criteria] int NULL,
  [id_function] int NULL,
  [id_params] int NULL,
  [indicator_id] int NULL,
  [priorisation_id] int NULL,
  [scenario_id] int NULL,
  [last_updated_date] datetime NOT NULL
);

CREATE TABLE [dbo].[PAR08] (
  [creator] nvarchar(150) NULL,
  [description] nvarchar(MAX) NULL,
  [historic_priorisation_id] int NULL,
  [id_algo] int NULL,
  [priorisation_id] int NULL,
  [statut] int NULL,
  [tag] nvarchar(150) NULL,
  [last_updated_date] datetime NOT NULL
);

CREATE TABLE [dbo].[PAR09] (
  [id] int NULL,
  [is_active] int NULL,
  [type] nvarchar(150) NULL,
  [last_updated_date] datetime NOT NULL
);

CREATE TABLE [dbo].[PAR10] (
  [group_id] bigint NULL,
  [criteria_name] varchar(MAX) NULL,
  [training_id] bigint NULL
);

CREATE TABLE [dbo].[PAR11] (
  [comparable_perimeter] int NULL,
  [id_trackers_package] int NULL,
  [pod] int NULL,
  [priorisation_id] int NULL,
  [study] int NULL,
  [zone_id] int NULL,
  [last_updated_date] datetime NOT NULL
);

CREATE TABLE [dbo].[PAR12] (
  [month] varchar(MAX) NULL,
  [year] bigint NULL,
  [training_id] bigint NULL,
  [perimeter_id] bigint NULL
);

CREATE TABLE [dbo].[PAR13] (
  [depth] nvarchar(150) NULL,
  [id_config] int NULL,
  [ponderation] numeric(20,5) NULL,
  [last_updated_date] datetime NOT NULL
);

CREATE TABLE [dbo].[PAR14] (
  [creator] nvarchar(150) NULL,
  [id_params] int NULL,
  [pos] int NULL,
  [value] numeric(20,5) NULL,
  [last_updated_date] datetime NOT NULL
);

CREATE TABLE [dbo].[PAR15] (
  [creator] nvarchar(150) NULL,
  [id_algo] int NULL,
  [id_function] int NULL,
  [last_updated_date] datetime NOT NULL
);

CREATE TABLE [dbo].[PAR16] (
  [perimeter_id] int NULL,
  [col_code] varchar(150) NULL,
  [config_id] int NULL,
  [default_indicator] int NULL,
  [hierarchy_table_name] varchar(150) NULL,
  [item_table_name] varchar(150) NULL,
  [model_outlier] int NULL,
  [threshold_outliers] varchar(150) NULL,
  [last_updated_date] datetime NOT NULL
);

CREATE TABLE [dbo].[PAR18] (
  [id_target] int NULL,
  [target] nvarchar(153) NULL,
  [tracker_or_model] varchar(150) NULL,
  [last_updated_date] datetime NOT NULL
);

CREATE TABLE [dbo].[PAR19] (
  [critical_threshold] numeric(20,5) NULL,
  [id_kci] int NULL,
  [target_id] int NULL,
  [warning_threshold] numeric(20,5) NULL,
  [last_updated_date] datetime NOT NULL
);

CREATE TABLE [dbo].[PAR20] (
  [model_outlier] int NULL,
  [perimeter_train] int NULL,
  [last_updated_date] datetime NOT NULL
);

CREATE TABLE [dbo].[PAR21] (
  [perimeter_id] int NULL,
  [default_indicator] int NULL,
  [dimension_id] int NULL,
  [par_value] nvarchar(150) NULL,
  [parameter] nvarchar(150) NULL,
  [scenario_id] int NULL,
  [script] varchar(150) NULL,
  [last_updated_date] datetime NOT NULL
);

CREATE TABLE [dbo].[PAR22] (
  [source_tracker] int NULL,
  [tracker_id] int NULL
);

CREATE TABLE [dbo].[PAR23] (
  [criteria] nvarchar(150) NULL,
  [description] nvarchar(MAX) NULL,
  [id_model] int NULL,
  [last_updated_date] datetime NOT NULL
);

CREATE TABLE [dbo].[PAR27] (
  [active] int NULL,
  [main_perimeter_id] int NULL,
  [priorisation_active] int NULL,
  [tracker_id] int NULL,
  [last_updated_date] datetime NOT NULL
);

CREATE TABLE [dbo].[PAR28] (
  [calibration_id] int NULL,
  [mat_value] numeric(20,5) NULL,
  [max_perf] numeric(20,5) NULL,
  [min_perf] numeric(20,5) NULL,
  [seuil_1] numeric(20,5) NULL,
  [seuil_2] numeric(20,5) NULL,
  [seuil_acc] numeric(20,5) NULL,
  [seuil_cr] numeric(20,5) NULL,
  [seuil_grav] numeric(20,5) NULL,
  [seuil_mat] numeric(20,5) NULL,
  [seuil_season] numeric(20,5) NULL,
  [last_updated_date] datetime NOT NULL
);

CREATE TABLE [dbo].[PAR29] (
  [hyperparameters_id] bigint NULL,
  [class] varchar(MAX) NULL,
  [threshold_inf] float NULL,
  [threshold_up] float NULL,
  [creator] varchar(MAX) NULL,
  [last_updated_date] date NULL
);

CREATE TABLE [dbo].[PAR30] (
  [hyperparameters_id] bigint NULL,
  [training_id] bigint NULL,
  [class] varchar(MAX) NULL,
  [threshold_inf] float NULL,
  [threshold_up] float NULL
);

CREATE TABLE [dbo].[PAR31] (
  [id] int NOT NULL,
  [critere] nvarchar(200) NOT NULL,
  PRIMARY KEY ([id])
);

CREATE TABLE [dbo].[PAR32] (
  [id_group] int NOT NULL,
  [id_critere] int NOT NULL,
  PRIMARY KEY ([id_group], [id_critere])
);

CREATE TABLE [dbo].[PAR33] (
  [id_new_crit] int NOT NULL,
  [id_used_crits] int NULL,
  [description] nvarchar(400) NULL,
  PRIMARY KEY ([id_new_crit])
);

CREATE TABLE [dbo].[parameter_qualitative_list] (
  [id_hyperparameter] int NOT NULL,
  [id_criteria_hyperparameter_qualitative] int NOT NULL,
  [id_training] int NULL,
  [inferior_threshold] decimal(18,6) NULL,
  [superior_threshold] decimal(18,6) NULL
);

CREATE TABLE [dbo].[parameter_quantitative_list] (
  [id_hyperparameter_quantitative] int NOT NULL,
  [id_criteria_hyperparameter_quantitative] int NOT NULL,
  [id_training] int NOT NULL,
  [value_dec] decimal(18,0) NULL,
  [value_varchar] nvarchar(255) NULL,
  PRIMARY KEY ([id_hyperparameter_quantitative], [id_criteria_hyperparameter_quantitative], [id_training])
);

CREATE TABLE [dbo].[period_perimeter] (
  [id] int IDENTITY(1,1) NOT NULL,
  [year] int NULL,
  [id_period] int NOT NULL,
  [id_perimeter] int NULL,
  [month] varchar(3) NULL,
  PRIMARY KEY ([id])
);

CREATE TABLE [dbo].[theme_criteria] (
  [id] int IDENTITY(1,1) NOT NULL,
  [name] nvarchar(255) NULL,
  PRIMARY KEY ([id])
);

CREATE TABLE [dbo].[training] (
  [id] int IDENTITY(1,1) NOT NULL,
  [name] nvarchar(150) NULL,
  PRIMARY KEY ([id])
);

CREATE TABLE [dbo].[training_application_list] (
  [id_training] int NOT NULL,
  [id_period_perimeter_apply] int NOT NULL,
  PRIMARY KEY ([id_training], [id_period_perimeter_apply])
);

CREATE TABLE [dbo].[training_train_list] (
  [id_period_perimeter_train] int NOT NULL,
  [id_training] int NOT NULL,
  PRIMARY KEY ([id_period_perimeter_train], [id_training])
);
