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
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import * as React from 'react';

import {
  formatLocalScheduleTime,
  LocalSchedulesPanel
} from '../LocalSchedulesWidget';
import { LocalScheduleService } from '../LocalScheduleService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('@elyra/pipeline-editor', () => {
  describe('LocalScheduleService', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('lists schedules from the local scheduling endpoint', async () => {
      const getRequest = jest
        .spyOn(RequestHandler, 'makeGetRequest')
        .mockResolvedValue({ schedules: [{ id: 'weekday' }] } as never);

      await expect(LocalScheduleService.listSchedules()).resolves.toEqual([
        { id: 'weekday' }
      ]);
      expect(getRequest).toHaveBeenCalledWith('elyra/pipeline/local/schedules');
    });

    it('creates a schedule with its pipeline definition', async () => {
      const postRequest = jest
        .spyOn(RequestHandler, 'makePostRequest')
        .mockResolvedValue({ id: 'weekday' } as never);
      const schedule = {
        display_name: 'Weekday pipeline',
        pipeline_definition: { id: 'pipeline' },
        cron_expression: '0 9 * * 1-5',
        enabled: true
      };

      await LocalScheduleService.createSchedule(schedule);

      expect(postRequest).toHaveBeenCalledWith(
        'elyra/pipeline/local/schedules',
        JSON.stringify(schedule)
      );
    });

    it('uses encoded schedule and run identifiers in detail endpoints', async () => {
      const putRequest = jest
        .spyOn(RequestHandler, 'makePutRequest')
        .mockResolvedValue({ id: 'daily/schedule' } as never);
      const getRequest = jest
        .spyOn(RequestHandler, 'makeGetRequest')
        .mockResolvedValue({ logs: [] } as never);
      const deleteRequest = jest
        .spyOn(RequestHandler, 'makeDeleteRequest')
        .mockResolvedValue(undefined);

      await LocalScheduleService.updateSchedule('daily/schedule', {
        enabled: false
      });
      await LocalScheduleService.getLogs('run/one');
      await LocalScheduleService.deleteSchedule('daily/schedule');

      expect(putRequest).toHaveBeenCalledWith(
        'elyra/pipeline/local/schedules/daily%2Fschedule',
        JSON.stringify({ enabled: false })
      );
      expect(getRequest).toHaveBeenCalledWith(
        'elyra/pipeline/local/runs/run%2Fone/logs'
      );
      expect(deleteRequest).toHaveBeenCalledWith(
        'elyra/pipeline/local/schedules/daily%2Fschedule'
      );
    });
  });

  describe('LocalSchedulesPanel', () => {
    it('labels absent next-run timestamps as unscheduled', () => {
      expect(formatLocalScheduleTime(null)).toBe('Not scheduled');
    });

    it('shows a selected schedule and its run history', async () => {
      const schedule = {
        id: 'weekday',
        display_name: 'Weekday pipeline',
        pipeline_definition: {},
        cron_expression: '0 9 * * 1-5',
        enabled: true,
        created_at: '2026-07-29T09:00:00',
        updated_at: '2026-07-29T09:00:00',
        next_run_at: null
      };
      jest
        .spyOn(LocalScheduleService, 'listSchedules')
        .mockResolvedValue([schedule]);
      jest.spyOn(LocalScheduleService, 'listRuns').mockResolvedValue([
        {
          id: 'run-1',
          schedule_id: 'weekday',
          status: 'succeeded',
          scheduled_at: '2026-07-29T09:00:00',
          started_at: '2026-07-29T09:00:00',
          finished_at: '2026-07-29T09:01:00',
          error_summary: null,
          log_path: null
        }
      ]);
      const container = document.createElement('div');
      const root = createRoot(container);

      await act(async () => {
        root.render(React.createElement(LocalSchedulesPanel));
      });
      const scheduleButton = Array.from(
        container.querySelectorAll('button')
      ).find((button) => button.textContent?.includes('Weekday pipeline'));
      expect(scheduleButton).toBeDefined();

      await act(async () => {
        scheduleButton?.dispatchEvent(
          new MouseEvent('click', { bubbles: true })
        );
      });

      expect(container.textContent).toContain('Run History');
      expect(container.textContent).toContain('succeeded');
      await act(async () => {
        root.unmount();
      });
    });
  });
});
