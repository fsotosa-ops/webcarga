INFO:stg_wingsuite_trips_test:dbt deps \

    --select stg_wingsuite_trips \

    --full-refresh --project-dir \

    /home/src/default_repo/dbt/tms --vars \

    {"env": "dev", "execution_date": "2026-06-17T18:54:48.622768", "interval_end_datetime": "2026-06-18T18:54:48.622768", "interval_start_datetime": "2026-06-17T18:54:48.622768", "event": {}, "configuration": {"dbt": {"command": "run"}, "dbt_profile_target": null, "dbt_project_name": "dbt/tms", "disable_query_preprocessing": false, "export_write_policy": "append", "file_source": {"path": "dbts/stg_wingsuite_trips.yaml"}, "use_raw_sql": false}, "context": {}, "pipeline_uuid": "batch_tms_monitor_trips", "block_uuid": "stg_wingsuite_trips", "repo_path": "/home/src/default_repo"} --profiles-dir \

    /home/src/default_repo/.profiles_interpolated_temp_471a659b-54a3-4720-a2c0-7f0450afeb0e

INFO:stg_wingsuite_trips_test:dbt run \

    --select stg_wingsuite_trips \

    --full-refresh --project-dir \

    /home/src/default_repo/dbt/tms --vars \

    {"env": "dev", "execution_date": "2026-06-17T18:54:48.622768", "interval_end_datetime": "2026-06-18T18:54:48.622768", "interval_start_datetime": "2026-06-17T18:54:48.622768", "event": {}, "configuration": {"dbt": {"command": "run"}, "dbt_profile_target": null, "dbt_project_name": "dbt/tms", "disable_query_preprocessing": false, "export_write_policy": "append", "file_source": {"path": "dbts/stg_wingsuite_trips.yaml"}, "use_raw_sql": false}, "context": {}, "pipeline_uuid": "batch_tms_monitor_trips", "block_uuid": "stg_wingsuite_trips", "repo_path": "/home/src/default_repo"} --profiles-dir \

    /home/src/default_repo/.profiles_interpolated_temp_471a659b-54a3-4720-a2c0-7f0450afeb0e

18:54:48  Running with dbt=1.8.7

INFO:stg_wingsuite_trips_test:Running with dbt=1.8.7

18:54:48  Registered adapter: postgres=1.8.2

INFO:stg_wingsuite_trips_test:Registered adapter: postgres=1.8.2

18:54:48  Unable to do partial parsing because config vars, config profile, or config target have changed

INFO:stg_wingsuite_trips_test:Unable to do partial parsing because config vars, config profile, or config target have changed

18:54:50  Found 10 models, 2 snapshots, 4 data tests, 6 sources, 548 macros

INFO:stg_wingsuite_trips_test:Found 10 models, 2 snapshots, 4 data tests, 6 sources, 548 macros

18:54:50  

INFO:stg_wingsuite_trips_test:

18:54:53  Concurrency: 4 threads (target='dev')

INFO:stg_wingsuite_trips_test:Concurrency: 4 threads (target='dev')

18:54:53  

INFO:stg_wingsuite_trips_test:

18:54:53  1 of 1 START sql view model silver.stg_wingsuite_trips ......................... [RUN]

INFO:stg_wingsuite_trips_test:1 of 1 START sql view model silver.stg_wingsuite_trips ......................... [RUN]

18:54:54  1 of 1 ERROR creating sql view model silver.stg_wingsuite_trips ................ [ERROR in 0.90s]

ERROR:stg_wingsuite_trips_test:1 of 1 ERROR creating sql view model silver.stg_wingsuite_trips ................ [ERROR in 0.90s]

18:54:54  

INFO:stg_wingsuite_trips_test:

18:54:54  Finished running 1 view model in 0 hours 0 minutes and 4.33 seconds (4.33s).

INFO:stg_wingsuite_trips_test:Finished running 1 view model in 0 hours 0 minutes and 4.33 seconds (4.33s).

18:54:55  

INFO:stg_wingsuite_trips_test:

18:54:55  Completed with 1 error and 0 warnings:

INFO:stg_wingsuite_trips_test:Completed with 1 error and 0 warnings:

18:54:55  

INFO:stg_wingsuite_trips_test:

18:54:55    Database Error in model stg_wingsuite_trips (models/silver/stg_wingsuite_trips.sql)

  column "trip_sk" does not exist

  LINE 33:             PARTITION BY trip_sk

                                    ^

  compiled code at target/run/tms/models/silver/stg_wingsuite_trips.sql

ERROR:stg_wingsuite_trips_test:  Database Error in model stg_wingsuite_trips (models/silver/stg_wingsuite_trips.sql)

  column "trip_sk" does not exist

  LINE 33:             PARTITION BY trip_sk

                                    ^

  compiled code at target/run/tms/models/silver/stg_wingsuite_trips.sql

18:54:55  

INFO:stg_wingsuite_trips_test:

18:54:55  Done. PASS=0 WARN=0 ERROR=1 SKIP=0 TOTAL=1

INFO:stg_wingsuite_trips_test:Done. PASS=0 WARN=0 ERROR=1 SKIP=0 TOTAL=1

Traceback (most recent call last):

Exception: None