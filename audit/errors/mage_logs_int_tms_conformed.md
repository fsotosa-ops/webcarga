INFO:int_tms_trips_conformed_test:dbt deps \

    --select int_tms_trips_conformed \

    --full-refresh --project-dir \

    /home/src/default_repo/dbt/tms --vars \

    {"env": "dev", "execution_date": "2026-06-17T19:05:54.714757", "interval_end_datetime": "2026-06-18T19:05:54.714757", "interval_start_datetime": "2026-06-17T19:05:54.714757", "event": {}, "configuration": {"dbt": {"command": "run"}, "dbt_profile_target": "", "dbt_project_name": "dbt/tms", "disable_query_preprocessing": false, "export_write_policy": "append", "file_source": {"path": "dbts/int_tms_trips_conformed.yaml"}, "use_raw_sql": false}, "context": {}, "pipeline_uuid": "batch_tms_monitor_trips", "block_uuid": "int_tms_trips_conformed", "repo_path": "/home/src/default_repo"} --profiles-dir \

    /home/src/default_repo/.profiles_interpolated_temp_936f7f6b-4e12-467b-beae-daf798737d07

INFO:int_tms_trips_conformed_test:dbt run \

    --select int_tms_trips_conformed \

    --full-refresh --project-dir \

    /home/src/default_repo/dbt/tms --vars \

    {"env": "dev", "execution_date": "2026-06-17T19:05:54.714757", "interval_end_datetime": "2026-06-18T19:05:54.714757", "interval_start_datetime": "2026-06-17T19:05:54.714757", "event": {}, "configuration": {"dbt": {"command": "run"}, "dbt_profile_target": "", "dbt_project_name": "dbt/tms", "disable_query_preprocessing": false, "export_write_policy": "append", "file_source": {"path": "dbts/int_tms_trips_conformed.yaml"}, "use_raw_sql": false}, "context": {}, "pipeline_uuid": "batch_tms_monitor_trips", "block_uuid": "int_tms_trips_conformed", "repo_path": "/home/src/default_repo"} --profiles-dir \

    /home/src/default_repo/.profiles_interpolated_temp_936f7f6b-4e12-467b-beae-daf798737d07

19:05:54  Running with dbt=1.8.7

INFO:int_tms_trips_conformed_test:Running with dbt=1.8.7

19:05:54  Registered adapter: postgres=1.8.2

INFO:int_tms_trips_conformed_test:Registered adapter: postgres=1.8.2

19:05:55  Unable to do partial parsing because config vars, config profile, or config target have changed

INFO:int_tms_trips_conformed_test:Unable to do partial parsing because config vars, config profile, or config target have changed

19:05:57  Found 10 models, 2 snapshots, 4 data tests, 6 sources, 548 macros

INFO:int_tms_trips_conformed_test:Found 10 models, 2 snapshots, 4 data tests, 6 sources, 548 macros

19:05:57  

INFO:int_tms_trips_conformed_test:

19:05:59  Concurrency: 4 threads (target='dev')

INFO:int_tms_trips_conformed_test:Concurrency: 4 threads (target='dev')

19:05:59  

INFO:int_tms_trips_conformed_test:

19:05:59  1 of 1 START sql view model silver.int_tms_trips_conformed ..................... [RUN]

INFO:int_tms_trips_conformed_test:1 of 1 START sql view model silver.int_tms_trips_conformed ..................... [RUN]

19:06:00  1 of 1 ERROR creating sql view model silver.int_tms_trips_conformed ............ [ERROR in 0.92s]

ERROR:int_tms_trips_conformed_test:1 of 1 ERROR creating sql view model silver.int_tms_trips_conformed ............ [ERROR in 0.92s]

19:06:01  

INFO:int_tms_trips_conformed_test:

19:06:01  Finished running 1 view model in 0 hours 0 minutes and 4.22 seconds (4.22s).

INFO:int_tms_trips_conformed_test:Finished running 1 view model in 0 hours 0 minutes and 4.22 seconds (4.22s).

19:06:01  

INFO:int_tms_trips_conformed_test:

19:06:01  Completed with 1 error and 0 warnings:

INFO:int_tms_trips_conformed_test:Completed with 1 error and 0 warnings:

19:06:01  

INFO:int_tms_trips_conformed_test:

19:06:01    Database Error in model int_tms_trips_conformed (models/silver/int_tms_trips_conformed.sql)

  column ml.ingestion_timestamp does not exist

  LINE 319:         ml.ingestion_timestamp,

                    ^

  compiled code at target/run/tms/models/silver/int_tms_trips_conformed.sql

ERROR:int_tms_trips_conformed_test:  Database Error in model int_tms_trips_conformed (models/silver/int_tms_trips_conformed.sql)

  column ml.ingestion_timestamp does not exist

  LINE 319:         ml.ingestion_timestamp,

                    ^

  compiled code at target/run/tms/models/silver/int_tms_trips_conformed.sql

19:06:01  

INFO:int_tms_trips_conformed_test:

19:06:01  Done. PASS=0 WARN=0 ERROR=1 SKIP=0 TOTAL=1

INFO:int_tms_trips_conformed_test:Done. PASS=0 WARN=0 ERROR=1 SKIP=0 TOTAL=1

Traceback (most recent call last):

Exception: None