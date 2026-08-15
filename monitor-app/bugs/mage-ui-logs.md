WARNING
2026-07-18 03:58:53.043



Details


Errors

block_run_id

191221

block_type

dbt

block_uuid

int_tms_trips_conformed

error

{
  "key": null,
  "ref": null,
  "props": {
    "error": {
      "message_formatted": [
        "None"
      ]
    }
  },
  "_owner": null
}

file name

int_tms_trips_conformed.log

file path

/home/src/mage_data/default_repo/pipelines/batch_tms_monitor_trips/.logs/9/20260718T035336_037826/int_tms_trips_conformed.log

level

WARNING

message

Exception thrown when attempting to run <function BlockExecutor.execute.<locals>.__execute_with_retry at 0x7fe0f8561b40>, attempt 1 of 1

Click to hide log
pipeline_run_id

6497

pipeline_uuid

batch_tms_monitor_trips

timestamp

1784347133.043165

uuid

c9061ba4a6a94e6b9444478323f01a94





Details

block_run_id

191221

block_type

dbt

block_uuid

int_tms_trips_conformed

file name

int_tms_trips_conformed.log

file path

/home/src/mage_data/default_repo/pipelines/batch_tms_monitor_trips/.logs/9/20260718T035336_037826/int_tms_trips_conformed.log

level

ERROR

message

  Database Error in model int_tms_trips_conformed (models/silver/int_tms_trips_conformed.sql)
  relation "silver.stg_qanalytics_trips" does not exist
  LINE 41:     SELECT * FROM "postgres"."silver"."stg_qanalytics_trips"
                             ^
  compiled code at target/run/tms/models/silver/int_tms_trips_conformed.sql

Click to show full log message
pipeline_run_id

6497

pipeline_uuid

batch_tms_monitor_trips

timestamp

1784347132.675395

uuid

4a89cb37b3fd45a2b8bbd8bf1ea82545



Details


Errors

block_run_id

191221

block_type

dbt

block_uuid

int_tms_trips_conformed

error

{
  "key": null,
  "ref": null,
  "props": {
    "error": {
      "message_formatted": [
        "Failed to execute k8s job mageai-20874-development-job-block-191221. Pod mageai-20874-development-job-block-191221-czftp container mage-job-container: exit_code=1, reason=Error, message=none\n\nCheck block run or pipeline run logs for the actual error."
      ]
    }
  },
  "_owner": null
}

file name

int_tms_trips_conformed.k8s.log

file path

/home/src/mage_data/default_repo/pipelines/batch_tms_monitor_trips/.logs/9/20260718T035336_037826/int_tms_trips_conformed.k8s.log

hostname

mageai-20874-development-7cd547f48c-nzfq7

level

EXCEPTION

message

Failed to execute block int_tms_trips_conformed

Click to hide log
pipeline_run_id

6497

pipeline_schedule_id

9

pipeline_uuid

batch_tms_monitor_trips

timestamp

1784347143.033998

uuid

d61be13ead7446698e91ffee00a6672c


EXCEPTION
2026-07-18 03:59:03.249



Details


Errors

block_run_id

191221

block_uuid

int_tms_trips_conformed

error

{
  "key": null,
  "ref": null,
  "props": {
    "error": {
      "message_formatted": [
        "{'type': 'Exception', 'message': 'Failed to execute k8s job mageai-20874-development-job-block-191221. Pod mageai-20874-development-job-block-191221-czftp container mage-job-container: exit_code=1, reason=Error, message=none\\n\\nCheck block run or pipeline run logs for the actual error.', 'traceback': ['  File \"/usr/local/lib/python3.10/site-packages/mage_ai/data_preparation/executors/block_executor.py\", line 657, in execute\\n    result = __execute_with_retry()\\n', '  File \"/usr/local/lib/python3.10/site-packages/mage_ai/shared/retry.py\", line 54, in retry_func\\n    raise e\\n', '  File \"/usr/local/lib/python3.10/site-packages/mage_ai/shared/retry.py\", line 38, in retry_func\\n    return func(*args, **kwargs)\\n', '  File \"/usr/local/lib/python3.10/site-packages/mage_ai/data_preparation/executors/block_executor.py\", line 631, in __execute_with_retry\\n    return self._execute(\\n', '  File \"/usr/local/lib/python3.10/site-packages/mage_ai/data_preparation/executors/k8s_block_executor.py\", line 97, in _execute\\n    job_manager.run_job(\\n', '  File \"/usr/local/lib/python3.10/site-packages/mage_ai/services/k8s/job_manager.py\", line 105, in run_job\\n    raise Exception(\\n']}"
      ]
    }
  },
  "_owner": null
}

file name

scheduler.log

file path

/home/src/mage_data/default_repo/pipelines/batch_tms_monitor_trips/.logs/9/20260718T035336_037826/scheduler.log

hostname

mageai-20874-development-7cd547f48c-nzfq7

level

EXCEPTION

message

BlockRun 191221 (block_uuid: int_tms_trips_conformed) failed.

Click to show full log message
pipeline_run_id

6497

pipeline_schedule_id

9

pipeline_uuid

batch_tms_monitor_trips

timestamp

1784347143.249397

uuid

68fab189081c44ce9839e5045613bd71