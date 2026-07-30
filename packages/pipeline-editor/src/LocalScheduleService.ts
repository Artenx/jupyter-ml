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
}

export interface ILocalScheduledRun {
  id: string;
  schedule_id: string;
  status: 'scheduled' | 'running' | 'succeeded' | 'failed' | 'skipped';
  scheduled_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_summary: string | null;
  log_path: string | null;
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
}
