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

import { RequestHandler } from '@elyra/services';
import { GenericObjectType } from '@elyra/ui-components';

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
}

export interface ILocalRetryPolicy {
  max_attempts: number;
  initial_delay_seconds: number;
  backoff_multiplier: number;
}

export interface ILocalScheduledRun {
  id: string;
  schedule_id: string;
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
  trigger_type: 'manual' | 'scheduled' | 'retry';
  attempt_number: number;
  parent_run_id: string | null;
  remote_kernel_id: string | null;
  next_retry_at: string | null;
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
}

interface ILocalRunResultsResponse {
  results: ILocalRunResult[];
}

const SCHEDULES_PATH = 'elyra/pipeline/local/schedules';

export const LOCAL_SCHEDULES_CHANGED_EVENT = 'elyra-local-schedules-changed';

/** Client for the authenticated local scheduling REST endpoints. */
export class LocalScheduleService {
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

  static async getLogs(runId: string): Promise<ILocalRunLogEntry[]> {
    const response = await RequestHandler.makeGetRequest<ILocalRunLogsResponse>(
      `elyra/pipeline/local/runs/${encodeURIComponent(runId)}/logs`
    );
    return response?.logs ?? [];
  }

  static async runNow(scheduleId: string): Promise<ILocalScheduledRun | undefined> {
    return RequestHandler.makePostRequest<ILocalScheduledRun>(
      `${SCHEDULES_PATH}/${encodeURIComponent(scheduleId)}/run`,
      '{}'
    );
  }

  static async retryRun(runId: string): Promise<ILocalScheduledRun | undefined> {
    return RequestHandler.makePostRequest<ILocalScheduledRun>(
      `elyra/pipeline/local/runs/${encodeURIComponent(runId)}/retry`,
      '{}'
    );
  }

  static async stopRun(runId: string): Promise<void> {
    await RequestHandler.makePostRequest(
      `elyra/pipeline/local/runs/${encodeURIComponent(runId)}/stop`,
      '{}'
    );
  }

  static async deleteRun(runId: string): Promise<void> {
    await RequestHandler.makeDeleteRequest(
      `elyra/pipeline/local/runs/${encodeURIComponent(runId)}`
    );
  }

  static async getResults(runId: string): Promise<ILocalRunResult[]> {
    const response = await RequestHandler.makeGetRequest<ILocalRunResultsResponse>(
      `elyra/pipeline/local/runs/${encodeURIComponent(runId)}/results`
    );
    return response?.results ?? [];
  }
}
