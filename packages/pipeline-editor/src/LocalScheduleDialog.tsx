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

export interface ILocalScheduleDialogValue {
  retry_max_attempts: string | number;
  retry_initial_delay_seconds: string | number;
  retry_backoff_multiplier: string | number;
}

export const retryPolicyFromDialog = (
  value: ILocalScheduleDialogValue
): {
  max_attempts: number;
  initial_delay_seconds: number;
  backoff_multiplier: number;
} => ({
  max_attempts: Number(value.retry_max_attempts),
  initial_delay_seconds: Number(value.retry_initial_delay_seconds),
  backoff_multiplier: Number(value.retry_backoff_multiplier)
});

interface ILocalScheduleDialogProps {
  displayName: string;
  cronExpression?: string;
  enabled?: boolean;
  retryPolicy?: {
    max_attempts: number;
    initial_delay_seconds: number;
    backoff_multiplier: number;
  };
}

/** Shared form body for creating and editing a local pipeline schedule. */
export const LocalScheduleDialog: React.FC<ILocalScheduleDialogProps> = ({
  displayName,
  cronExpression = '0 * * * *',
  enabled = true,
  retryPolicy = {
    max_attempts: 3,
    initial_delay_seconds: 60,
    backoff_multiplier: 2
  }
}) => {
  return (
    <form className="elyra-dialog-form">
      <label htmlFor="local_schedule_name">Schedule name:</label>
      <br />
      <input
        id="local_schedule_name"
        name="display_name"
        type="text"
        defaultValue={displayName}
        data-form-required
      />
      <br />
      <br />
      <label htmlFor="local_schedule_cron">Cron expression:</label>
      <br />
      <input
        id="local_schedule_cron"
        name="cron_expression"
        type="text"
        defaultValue={cronExpression}
        data-form-required
      />
      <p className="elyra-localSchedule-hint">
        Five fields: minute hour day-of-month month day-of-week
      </p>
      <input
        id="local_schedule_enabled"
        name="enabled"
        type="checkbox"
        className="elyra-Dialog-checkbox"
        defaultChecked={enabled}
      />
      <label htmlFor="local_schedule_enabled">Enabled</label>
      <fieldset className="elyra-localSchedule-retry">
        <legend>Retry policy</legend>
        <label htmlFor="local_schedule_retry_attempts">Maximum attempts:</label>
        <input id="local_schedule_retry_attempts" name="retry_max_attempts" type="number" min="1" defaultValue={retryPolicy.max_attempts} />
        <label htmlFor="local_schedule_retry_delay">Initial delay (seconds):</label>
        <input id="local_schedule_retry_delay" name="retry_initial_delay_seconds" type="number" min="0" defaultValue={retryPolicy.initial_delay_seconds} />
        <label htmlFor="local_schedule_retry_backoff">Backoff multiplier:</label>
        <input id="local_schedule_retry_backoff" name="retry_backoff_multiplier" type="number" min="1" step="0.1" defaultValue={retryPolicy.backoff_multiplier} />
      </fieldset>
    </form>
  );
};
