/*
 * Copyright 2018-2026 Elyra Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { RequestHandler } from './requestHandler';
import { GenericObjectType } from './types';

export interface ILocalSchedule {
  id: string;
  display_name: string;
  pipeline_definition: GenericObjectType;
  cron_expression: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  next_run_at: string | null;
  retry_policy: ILocalRetryPolicy;
  retention_policy: ILocalRetentionPolicy;
}

export interface ILocalRetryPolicy {
  max_attempts: number;
  initial_delay_seconds: number;
  backoff_multiplier: number;
}

export interface ILocalRetentionPolicy {
  retention_mode: 'records' | 'days';
  max_records: number;
  retention_days: number;
}

export interface ILocalScheduledRun {
  id: string;
  schedule_id: string | null;
  status:
    | 'queued'
    | 'scheduled'
    | 'running'
    | 'retrying'
    | 'succeeded'
    | 'failed'
    | 'stopped'
    | 'skipped';
  scheduled_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_summary: string | null;
  log_path: string | null;
  trigger_type: 'direct' | 'manual' | 'scheduled' | 'retry';
  attempt_number: number;
  parent_run_id: string | null;
  remote_kernel_id: string | null;
  next_retry_at: string | null;
  pipeline_definition?: GenericObjectType;
}

export interface ILocalRunLogEntry {
  timestamp: string;
  level: string;
  message: string;
  operation_name: string | null;
}

export interface ILocalSchedulePayload {
  display_name: string;
  pipeline_definition: GenericObjectType;
  cron_expression: string;
  enabled: boolean;
  retry_policy?: ILocalRetryPolicy;
  retention_policy?: ILocalRetentionPolicy;
}

export interface ILocalRunResult {
  id: string;
  kind: 'notebook' | 'file' | 'remote_kernel' | 'link';
  location: string;
  display_name: string;
  operation_name: string | null;
}

interface ILocalSchedulesResponse {
  schedules: ILocalSchedule[];
}

interface ILocalRunsResponse {
  runs: ILocalScheduledRun[];
}

interface ILocalRunLogsResponse {
  logs: ILocalRunLogEntry[];
  total: number;
  offset: number;
  limit: number | null;
}

interface ILocalRunResultsResponse {
  results: ILocalRunResult[];
}

const SCHEDULES_PATH = 'jupyter-ml/local/schedules';
const RUNS_PATH = 'jupyter-ml/local/runs';

export const JOB_SCHEDULER_CHANGED_EVENT = 'jupyter-ml-job-scheduler-changed';

/** Extract pipeline name from a pipeline definition object. */
export const getPipelineName = (
  pipelineDefinition: GenericObjectType | undefined
): string => {
  if (!pipelineDefinition) {
    return '';
  }
  const pipelines = pipelineDefinition.pipelines;
  if (Array.isArray(pipelines) && pipelines.length > 0) {
    const appData = pipelines[0]?.app_data;
    if (appData?.properties?.name) {
      return appData.properties.name;
    }
  }
  return '';
};

/** Client for the authenticated local scheduling REST endpoints. */
export class JobSchedulerService {
  static async listSchedules(): Promise<ILocalSchedule[]> {
    const response =
      await RequestHandler.makeGetRequest<ILocalSchedulesResponse>(
        SCHEDULES_PATH
      );
    return response?.schedules ?? [];
  }

  static async createSchedule(
    schedule: ILocalSchedulePayload
  ): Promise<ILocalSchedule | undefined> {
    return RequestHandler.makePostRequest<ILocalSchedule>(
      SCHEDULES_PATH,
      JSON.stringify(schedule)
    );
  }

  static async updateSchedule(
    scheduleId: string,
    schedule: Partial<ILocalSchedulePayload>
  ): Promise<ILocalSchedule | undefined> {
    return RequestHandler.makePutRequest<ILocalSchedule>(
      `${SCHEDULES_PATH}/${encodeURIComponent(scheduleId)}`,
      JSON.stringify(schedule)
    );
  }

  static async deleteSchedule(scheduleId: string): Promise<void> {
    await RequestHandler.makeDeleteRequest(
      `${SCHEDULES_PATH}/${encodeURIComponent(scheduleId)}`
    );
  }

  static async listRuns(scheduleId: string): Promise<ILocalScheduledRun[]> {
    const response = await RequestHandler.makeGetRequest<ILocalRunsResponse>(
      `${SCHEDULES_PATH}/${encodeURIComponent(scheduleId)}/runs`
    );
    return response?.runs ?? [];
  }

  static async listDirectRuns(): Promise<ILocalScheduledRun[]> {
    const response = await RequestHandler.makeGetRequest<ILocalRunsResponse>(
      RUNS_PATH
    );
    return response?.runs ?? [];
  }

  static async getLogs(
    run: string,
    offset = 0,
    limit = 500,
    tail = false
  ): Promise<ILocalRunLogsResponse> {
    const query = `?offset=${offset}&limit=${limit}${tail ? '&tail=1' : ''}`;
    const response = await RequestHandler.makeGetRequest<ILocalRunLogsResponse>(
      `${RUNS_PATH}/${encodeURIComponent(run)}/logs${query}`
    );
    return response ?? { logs: [], total: 0, offset, limit };
  }

  static async runNow(scheduleId: string): Promise<ILocalScheduledRun | undefined> {
    return RequestHandler.makePostRequest<ILocalScheduledRun>(
      `${SCHEDULES_PATH}/${encodeURIComponent(scheduleId)}/run`,
      '{}'
    );
  }

  static async retryRun(runId: string): Promise<ILocalScheduledRun | undefined> {
    return RequestHandler.makePostRequest<ILocalScheduledRun>(
      `${RUNS_PATH}/${encodeURIComponent(runId)}/retry`,
      '{}'
    );
  }

  static async stopRun(runId: string): Promise<void> {
    await RequestHandler.makePostRequest(
      `${RUNS_PATH}/${encodeURIComponent(runId)}/stop`,
      '{}'
    );
  }

  static async deleteRun(runId: string): Promise<void> {
    await RequestHandler.makeDeleteRequest(
      `${RUNS_PATH}/${encodeURIComponent(runId)}`
    );
  }

  static async getResults(runId: string): Promise<ILocalRunResult[]> {
    const response = await RequestHandler.makeGetRequest<ILocalRunResultsResponse>(
      `${RUNS_PATH}/${encodeURIComponent(runId)}/results`
    );
    return response?.results ?? [];
  }
}
