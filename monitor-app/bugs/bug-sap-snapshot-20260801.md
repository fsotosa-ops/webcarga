Traceback (most recent call last):

Exception: No such option: --full-refresh

INFO:tms_sap_snapshot_test:dbt deps \

    --select tms_sap_snapshot \

    --full-refresh --project-dir \

    /home/src/default_repo/dbt/tms --vars \

    {"env": "dev", "execution_date": "2026-08-01T15:50:33.324391", "interval_end_datetime": "2026-08-02T15:50:33.324391", "interval_start_datetime": "2026-08-01T15:50:33.324391", "event": {}, "configuration": {"data_provider": "postgres", "data_provider_profile": "default", "dbt": {"command": "snapshot"}, "dbt_project_name": "dbt/tms", "disable_query_preprocessing": false, "export_write_policy": "append", "file_path": "dbts/tms_sap_snapshot.yaml", "file_source": {"path": "dbts/tms_sap_snapshot.yaml"}, "use_raw_sql": false}, "context": {}, "pipeline_uuid": "batch_tms_monitor_trips", "block_uuid": "tms_sap_snapshot", "repo_path": "/home/src/default_repo"} --profiles-dir \

    /home/src/default_repo/.profiles_interpolated_temp_c78eed75-99ca-4b72-801d-2009989409ac

Traceback (most recent call last):

Exception: No such option: --full-refresh

INFO:tms_sap_snapshot_test:dbt snapshot \

    --select tms_sap_snapshot \

    --full-refresh --project-dir \

    /home/src/default_repo/dbt/tms --vars \

    {"env": "dev", "execution_date": "2026-08-01T15:50:33.324391", "interval_end_datetime": "2026-08-02T15:50:33.324391", "interval_start_datetime": "2026-08-01T15:50:33.324391", "event": {}, "configuration": {"data_provider": "postgres", "data_provider_profile": "default", "dbt": {"command": "snapshot"}, "dbt_project_name": "dbt/tms", "disable_query_preprocessing": false, "export_write_policy": "append", "file_path": "dbts/tms_sap_snapshot.yaml", "file_source": {"path": "dbts/tms_sap_snapshot.yaml"}, "use_raw_sql": false}, "context": {}, "pipeline_uuid": "batch_tms_monitor_trips", "block_uuid": "tms_sap_snapshot", "repo_path": "/home/src/default_repo"} --profiles-dir \

    /home/src/default_repo/.profiles_interpolated_temp_c78eed75-99ca-4b72-801d-2009989409ac

Traceback (most recent call last):

Exception: No such option: --full-refresh







INFO:tms_sap_snapshot_test:dbt deps \

    --select tms_sap_snapshot \

    --project-dir /home/src/default_repo/dbt/tms \

    --vars {"env": "dev", "execution_date": "2026-08-01T15:57:21.166577", "interval_end_datetime": "2026-08-02T15:57:21.166577", "interval_start_datetime": "2026-08-01T15:57:21.166577", "event": {}, "configuration": {"data_provider": "postgres", "data_provider_profile": "default", "dbt": {"command": "snapshot"}, "dbt_project_name": "dbt/tms", "disable_query_preprocessing": false, "export_write_policy": "append", "file_path": "dbts/tms_sap_snapshot.yaml", "file_source": {"path": "dbts/tms_sap_snapshot.yaml"}, "use_raw_sql": false}, "context": {}, "pipeline_uuid": "batch_tms_monitor_trips", "block_uuid": "tms_sap_snapshot", "repo_path": "/home/src/default_repo"} \

    --profiles-dir /home/src/default_repo/.profiles_interpolated_temp_3b6872ac-a3d0-4226-858a-8d116518f4f8

INFO:tms_sap_snapshot_test:dbt snapshot \

    --select tms_sap_snapshot \

    --project-dir /home/src/default_repo/dbt/tms \

    --vars {"env": "dev", "execution_date": "2026-08-01T15:57:21.166577", "interval_end_datetime": "2026-08-02T15:57:21.166577", "interval_start_datetime": "2026-08-01T15:57:21.166577", "event": {}, "configuration": {"data_provider": "postgres", "data_provider_profile": "default", "dbt": {"command": "snapshot"}, "dbt_project_name": "dbt/tms", "disable_query_preprocessing": false, "export_write_policy": "append", "file_path": "dbts/tms_sap_snapshot.yaml", "file_source": {"path": "dbts/tms_sap_snapshot.yaml"}, "use_raw_sql": false}, "context": {}, "pipeline_uuid": "batch_tms_monitor_trips", "block_uuid": "tms_sap_snapshot", "repo_path": "/home/src/default_repo"} \

    --profiles-dir /home/src/default_repo/.profiles_interpolated_temp_3b6872ac-a3d0-4226-858a-8d116518f4f8

15:57:21  Running with dbt=1.8.7

INFO:tms_sap_snapshot_test:Running with dbt=1.8.7

15:57:21  Registered adapter: postgres=1.8.2

INFO:tms_sap_snapshot_test:Registered adapter: postgres=1.8.2

15:57:21  Unable to do partial parsing because config vars, config profile, or config target have changed

INFO:tms_sap_snapshot_test:Unable to do partial parsing because config vars, config profile, or config target have changed

15:57:23  Found 12 models, 2 snapshots, 48 data tests, 6 sources, 548 macros

INFO:tms_sap_snapshot_test:Found 12 models, 2 snapshots, 48 data tests, 6 sources, 548 macros

15:57:23  

INFO:tms_sap_snapshot_test:

15:57:26  Concurrency: 4 threads (target='dev')

INFO:tms_sap_snapshot_test:Concurrency: 4 threads (target='dev')

15:57:26  

INFO:tms_sap_snapshot_test:

15:57:26  1 of 1 START snapshot bronze.tms_sap_snapshot .................................. [RUN]

INFO:tms_sap_snapshot_test:1 of 1 START snapshot bronze.tms_sap_snapshot .................................. [RUN]

15:57:27  1 of 1 ERROR snapshotting bronze.tms_sap_snapshot .............................. [ERROR in 0.66s]

ERROR:tms_sap_snapshot_test:1 of 1 ERROR snapshotting bronze.tms_sap_snapshot .............................. [ERROR in 0.66s]

15:57:28  

INFO:tms_sap_snapshot_test:

15:57:28  Finished running 1 snapshot in 0 hours 0 minutes and 4.27 seconds (4.27s).

INFO:tms_sap_snapshot_test:Finished running 1 snapshot in 0 hours 0 minutes and 4.27 seconds (4.27s).

15:57:28  

INFO:tms_sap_snapshot_test:

15:57:28  Completed with 1 error and 0 warnings:

INFO:tms_sap_snapshot_test:Completed with 1 error and 0 warnings:

15:57:28  

INFO:tms_sap_snapshot_test:

15:57:28    Database Error in snapshot tms_sap_snapshot (snapshots/tms_sap_snapshot.sql)

  syntax error at or near ")"

  LINE 35:   LOCAL/RETORNANDO/CERRADO*/etc.), y el Estado SÍ cambia ent...

                                           ^

ERROR:tms_sap_snapshot_test:  Database Error in snapshot tms_sap_snapshot (snapshots/tms_sap_snapshot.sql)

  syntax error at or near ")"

  LINE 35:   LOCAL/RETORNANDO/CERRADO*/etc.), y el Estado SÍ cambia ent...

                                           ^

15:57:28  

INFO:tms_sap_snapshot_test:

15:57:28  Done. PASS=0 WARN=0 ERROR=1 SKIP=0 TOTAL=1

INFO:tms_sap_snapshot_test:Done. PASS=0 WARN=0 ERROR=1 SKIP=0 TOTAL=1

Traceback (most recent call last):

Exception: None