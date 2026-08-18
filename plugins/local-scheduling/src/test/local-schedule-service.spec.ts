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

import * as React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';

import { LocalScheduleService } from '../LocalScheduleService';
import { RequestHandler } from '../requestHandler';
import {
  formatLocalScheduleTime,
  LocalRunLogWidget,
  LocalSchedulesPanel
} from '../LocalSchedulesWidget';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('@jupyter-ml/local-scheduling', () => {
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
      expect(getRequest).toHaveBeenCalledWith('jupyter-ml/local/schedules');
    });

    it('lists direct runs separately from scheduled runs', async () => {
      const getRequest = jest
        .spyOn(RequestHandler, 'makeGetRequest')
        .mockResolvedValue({ runs: [{ id: 'direct-run' }] } as never);

      await expect(LocalScheduleService.listDirectRuns()).resolves.toEqual([
        { id: 'direct-run' }
      ]);
      expect(getRequest).toHaveBeenCalledWith('jupyter-ml/local/runs');
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
        'jupyter-ml/local/schedules',
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
        'jupyter-ml/local/schedules/daily%2Fschedule',
        JSON.stringify({ enabled: false })
      );
      expect(getRequest).toHaveBeenCalledWith(
        'jupyter-ml/local/runs/run%2Fone/logs'
      );
      expect(deleteRequest).toHaveBeenCalledWith(
        'jupyter-ml/local/schedules/daily%2Fschedule'
      );
    });

    it('controls runs and reads results through encoded task endpoints', async () => {
      const postRequest = jest
        .spyOn(RequestHandler, 'makePostRequest')
        .mockResolvedValue({ id: 'run/one' } as never);
      const getRequest = jest
        .spyOn(RequestHandler, 'makeGetRequest')
        .mockResolvedValue({ results: [{ id: 'result-1' }] } as never);
      const deleteRequest = jest
        .spyOn(RequestHandler, 'makeDeleteRequest')
        .mockResolvedValue(undefined);

      await LocalScheduleService.runNow('daily/schedule');
      await LocalScheduleService.retryRun('run/one');
      await LocalScheduleService.stopRun('run/one');
      await LocalScheduleService.getResults('run/one');
      await LocalScheduleService.deleteRun('run/one');

      expect(postRequest).toHaveBeenNthCalledWith(
        1,
        'jupyter-ml/local/schedules/daily%2Fschedule/run',
        '{}'
      );
      expect(postRequest).toHaveBeenNthCalledWith(
        2,
        'jupyter-ml/local/runs/run%2Fone/retry',
        '{}'
      );
      expect(postRequest).toHaveBeenNthCalledWith(
        3,
        'jupyter-ml/local/runs/run%2Fone/stop',
        '{}'
      );
      expect(getRequest).toHaveBeenCalledWith(
        'jupyter-ml/local/runs/run%2Fone/results'
      );
      expect(deleteRequest).toHaveBeenCalledWith(
        'jupyter-ml/local/runs/run%2Fone'
      );
    });
  });

  describe('LocalSchedulesPanel', () => {
    it('labels absent next-run timestamps as unscheduled', () => {
      expect(formatLocalScheduleTime(null)).toBe('Not scheduled');
    });

    it('shows a create entry and calls onCreate from the sidebar header', async () => {
      jest.spyOn(LocalScheduleService, 'listSchedules').mockResolvedValue([]);
      const onCreate = jest.fn(async (): Promise<void> => undefined);
      const container = document.createElement('div');
      const root = createRoot(container);

      await act(async () => {
        root.render(React.createElement(LocalSchedulesPanel, { onCreate }));
      });
      expect(container.textContent).toContain('No local schedules.');
      const createButton = Array.from(
        container.querySelectorAll('button')
      ).find((button) =>
        button.textContent?.includes('Create Local Schedule')
      );
      expect(createButton).toBeDefined();

      await act(async () => {
        createButton?.dispatchEvent(
          new MouseEvent('click', { bubbles: true })
        );
      });
      expect(onCreate).toHaveBeenCalledTimes(1);
      await act(async () => {
        root.unmount();
      });
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
        next_run_at: null,
        retry_policy: {
          max_attempts: 3,
          initial_delay_seconds: 60,
          backoff_multiplier: 2
        }
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
          log_path: null,
          trigger_type: 'scheduled',
          attempt_number: 1,
          parent_run_id: null,
          remote_kernel_id: null,
          next_retry_at: null
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

    it('lists direct runs and reveals an Enterprise Gateway run log widget', async () => {
      jest.spyOn(LocalScheduleService, 'listSchedules').mockResolvedValue([]);
      jest.spyOn(LocalScheduleService, 'listDirectRuns').mockResolvedValue([
        {
          id: 'direct-run',
          schedule_id: null,
          status: 'running',
          scheduled_at: '2026-07-31T09:00:00',
          started_at: '2026-07-31T09:00:00',
          finished_at: null,
          error_summary: null,
          log_path: null,
          trigger_type: 'direct',
          attempt_number: 1,
          parent_run_id: null,
          remote_kernel_id: 'gateway-kernel-1',
          next_retry_at: null
        }
      ]);
      jest.spyOn(LocalScheduleService, 'getLogs').mockResolvedValue([
        {
          timestamp: '2026-07-31T09:00:00',
          level: 'INFO',
          message: 'Started on gateway',
          operation_name: null
        }
      ]);
      jest.spyOn(LocalScheduleService, 'getResults').mockResolvedValue([]);

      const onOpenLogs = jest.fn();
      const container = document.createElement('div');
      const root = createRoot(container);

      await act(async () => {
        root.render(
          React.createElement(LocalSchedulesPanel, { onOpenLogs })
        );
      });

      const directButton = Array.from(
        container.querySelectorAll('button')
      ).find((button) => button.textContent?.includes('Direct Runs'));
      expect(directButton).toBeDefined();

      await act(async () => {
        directButton?.dispatchEvent(
          new MouseEvent('click', { bubbles: true })
        );
      });

      return act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        const runButton = Array.from(
          container.querySelectorAll('button')
        ).find((button) => button.textContent?.includes('direct-run'));
        runButton?.dispatchEvent(
          new MouseEvent('click', { bubbles: true })
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      }).then(() => {
        expect(onOpenLogs).toHaveBeenCalledTimes(1);
        expect(container.textContent).toContain('gateway-kernel-1');

        const run = { id: 'direct-run' } as never;
        const logWidget = new LocalRunLogWidget(run, [
          {
            timestamp: '2026-07-31T09:00:00',
            level: 'INFO',
            message: 'Started on gateway',
            operation_name: null
          }
        ]);
        expect(logWidget.node.textContent).toContain('Started on gateway');
      });
    });
  });
});
