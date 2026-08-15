INFO:app_trips_update_test:dbt deps \

    --select +trips \

    trip_stops --vars \

    {"env": "dev", "execution_date": "2026-07-18T05:35:16.490965", "interval_end_datetime": "2026-07-19T05:35:16.490965", "interval_start_datetime": "2026-07-18T05:35:16.490965", "event": {}, "configuration": {"dbt": {"command": "run"}, "dbt_profile_target": "", "dbt_project_name": "dbt/tms", "disable_query_preprocessing": false, "export_write_policy": "append", "file_source": {"path": "dbts/app_trips_update.yaml"}, "use_raw_sql": false}, "context": {}, "pipeline_uuid": "batch_tms_monitor_trips", "block_uuid": "app_trips_update", "repo_path": "/home/src/default_repo", "start_date": "2026-05-16"} --project-dir \

    /home/src/default_repo/dbt/tms --profiles-dir \

    /home/src/default_repo/.profiles_interpolated_temp_1a209a22-99eb-42c2-96ab-745d35495588

INFO:app_trips_update_test:dbt run \

    --select +trips \

    trip_stops --vars \

    {"env": "dev", "execution_date": "2026-07-18T05:35:16.490965", "interval_end_datetime": "2026-07-19T05:35:16.490965", "interval_start_datetime": "2026-07-18T05:35:16.490965", "event": {}, "configuration": {"dbt": {"command": "run"}, "dbt_profile_target": "", "dbt_project_name": "dbt/tms", "disable_query_preprocessing": false, "export_write_policy": "append", "file_source": {"path": "dbts/app_trips_update.yaml"}, "use_raw_sql": false}, "context": {}, "pipeline_uuid": "batch_tms_monitor_trips", "block_uuid": "app_trips_update", "repo_path": "/home/src/default_repo", "start_date": "2026-05-16"} --project-dir \

    /home/src/default_repo/dbt/tms --profiles-dir \

    /home/src/default_repo/.profiles_interpolated_temp_1a209a22-99eb-42c2-96ab-745d35495588

05:35:16  Running with dbt=1.8.7

INFO:app_trips_update_test:Running with dbt=1.8.7

05:35:17  Registered adapter: postgres=1.8.2

INFO:app_trips_update_test:Registered adapter: postgres=1.8.2

05:35:17  Unable to do partial parsing because config vars, config profile, or config target have changed

INFO:app_trips_update_test:Unable to do partial parsing because config vars, config profile, or config target have changed

05:35:19  [WARNING]: Deprecated functionality

The `tests` config has been renamed to `data_tests`. Please see

https://docs.getdbt.com/docs/build/data-tests#new-data_tests-syntax for more

information.

WARNING:app_trips_update_test:[WARNING]: Deprecated functionality

The `tests` config has been renamed to `data_tests`. Please see

https://docs.getdbt.com/docs/build/data-tests#new-data_tests-syntax for more

information.

05:35:20  Found 12 models, 2 snapshots, 38 data tests, 6 sources, 548 macros

INFO:app_trips_update_test:Found 12 models, 2 snapshots, 38 data tests, 6 sources, 548 macros

05:35:20  

INFO:app_trips_update_test:

05:35:23  Concurrency: 4 threads (target='dev')

INFO:app_trips_update_test:Concurrency: 4 threads (target='dev')

05:35:23  

INFO:app_trips_update_test:

05:35:23  1 of 8 START sql incremental model silver.tms_milestone_trips .................. [RUN]

05:35:23  2 of 8 START sql view model silver.stg_sodimac_trips ........................... [RUN]

05:35:23  3 of 8 START sql view model silver.stg_wingsuite_trips ......................... [RUN]

INFO:app_trips_update_test:1 of 8 START sql incremental model silver.tms_milestone_trips .................. [RUN]

INFO:app_trips_update_test:2 of 8 START sql view model silver.stg_sodimac_trips ........................... [RUN]

INFO:app_trips_update_test:3 of 8 START sql view model silver.stg_wingsuite_trips ......................... [RUN]

05:35:24  2 of 8 OK created sql view model silver.stg_sodimac_trips ...................... [CREATE VIEW in 1.54s]

INFO:app_trips_update_test:2 of 8 OK created sql view model silver.stg_sodimac_trips ...................... [CREATE VIEW in 1.54s]

05:35:24  3 of 8 OK created sql view model silver.stg_wingsuite_trips .................... [CREATE VIEW in 1.56s]

INFO:app_trips_update_test:3 of 8 OK created sql view model silver.stg_wingsuite_trips .................... [CREATE VIEW in 1.56s]

05:35:26  1 of 8 OK created sql incremental model silver.tms_milestone_trips ............. [MERGE 0 in 2.68s]

INFO:app_trips_update_test:1 of 8 OK created sql incremental model silver.tms_milestone_trips ............. [MERGE 0 in 2.68s]

05:35:26  4 of 8 START sql view model silver.stg_qanalytics_trips ........................ [RUN]

INFO:app_trips_update_test:4 of 8 START sql view model silver.stg_qanalytics_trips ........................ [RUN]

05:35:27  4 of 8 OK created sql view model silver.stg_qanalytics_trips ................... [CREATE VIEW in 1.14s]

INFO:app_trips_update_test:4 of 8 OK created sql view model silver.stg_qanalytics_trips ................... [CREATE VIEW in 1.14s]

05:35:27  5 of 8 START sql view model silver.stg_qanalytics_sap_only_trips ............... [RUN]

INFO:app_trips_update_test:5 of 8 START sql view model silver.stg_qanalytics_sap_only_trips ............... [RUN]

05:35:28  5 of 8 OK created sql view model silver.stg_qanalytics_sap_only_trips .......... [CREATE VIEW in 1.06s]

INFO:app_trips_update_test:5 of 8 OK created sql view model silver.stg_qanalytics_sap_only_trips .......... [CREATE VIEW in 1.06s]

05:35:28  6 of 8 START sql view model silver.int_tms_trips_conformed ..................... [RUN]

INFO:app_trips_update_test:6 of 8 START sql view model silver.int_tms_trips_conformed ..................... [RUN]

05:35:29  6 of 8 OK created sql view model silver.int_tms_trips_conformed ................ [CREATE VIEW in 1.29s]

INFO:app_trips_update_test:6 of 8 OK created sql view model silver.int_tms_trips_conformed ................ [CREATE VIEW in 1.29s]

05:35:29  7 of 8 START sql incremental model app.trips ................................... [RUN]

INFO:app_trips_update_test:7 of 8 START sql incremental model app.trips ................................... [RUN]

05:35:37  7 of 8 OK created sql incremental model app.trips .............................. [MERGE 1 in 7.59s]

INFO:app_trips_update_test:7 of 8 OK created sql incremental model app.trips .............................. [MERGE 1 in 7.59s]

05:35:37  8 of 8 START sql incremental model app.trip_stops .............................. [RUN]

INFO:app_trips_update_test:8 of 8 START sql incremental model app.trip_stops .............................. [RUN]

05:35:38  8 of 8 ERROR creating sql incremental model app.trip_stops ..................... [ERROR in 0.83s]

ERROR:app_trips_update_test:8 of 8 ERROR creating sql incremental model app.trip_stops ..................... [ERROR in 0.83s]

05:35:38  

INFO:app_trips_update_test:

05:35:38  Finished running 5 view models, 3 incremental models in 0 hours 0 minutes and 18.32 seconds (18.32s).

INFO:app_trips_update_test:Finished running 5 view models, 3 incremental models in 0 hours 0 minutes and 18.32 seconds (18.32s).

05:35:39  

INFO:app_trips_update_test:

05:35:39  Completed with 1 error and 0 warnings:

INFO:app_trips_update_test:Completed with 1 error and 0 warnings:

05:35:39  

INFO:app_trips_update_test:

05:35:39    Database Error in model trip_stops (models/app/trip_stops.sql)

  syntax error at or near "int_tms_trips_conformed"

  LINE 21: ...              app_trips.sql) — NO las capas stg_*/int_tms_tr...

                                                                ^

  compiled code at target/run/tms/models/app/trip_stops.sql

ERROR:app_trips_update_test:  Database Error in model trip_stops (models/app/trip_stops.sql)

  syntax error at or near "int_tms_trips_conformed"

  LINE 21: ...              app_trips.sql) — NO las capas stg_*/int_tms_tr...

                                                                ^

  compiled code at target/run/tms/models/app/trip_stops.sql

05:35:39  

INFO:app_trips_update_test:

05:35:39  Done. PASS=7 WARN=0 ERROR=1 SKIP=0 TOTAL=8

INFO:app_trips_update_test:Done. PASS=7 WARN=0 ERROR=1 SKIP=0 TOTAL=8

Traceback (most recent call last):

Exception: None