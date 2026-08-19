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

export interface IJobSchedulerDialogValue {
  retry_max_attempts: string | number;
  retry_initial_delay_seconds: string | number;
  retry_backoff_multiplier: string | number;
  retention_max_records: string | number;
  retention_days: string | number;
}

export const retryPolicyFromDialog = (
  value: IJobSchedulerDialogValue
): {
  max_attempts: number;
  initial_delay_seconds: number;
  backoff_multiplier: number;
} => ({
  max_attempts: Number(value.retry_max_attempts),
  initial_delay_seconds: Number(value.retry_initial_delay_seconds),
  backoff_multiplier: Number(value.retry_backoff_multiplier)
});

export const retentionPolicyFromDialog = (
  value: IJobSchedulerDialogValue
): {
  max_records: number;
  retention_days: number;
} => ({
  max_records: Number(value.retention_max_records),
  retention_days: Number(value.retention_days)
});

interface IJobSchedulerDialogProps {
  displayName: string;
  cronExpression?: string;
  enabled?: boolean;
  retryPolicy?: {
    max_attempts: number;
    initial_delay_seconds: number;
    backoff_multiplier: number;
  };
  retentionPolicy?: {
    max_records: number;
    retention_days: number;
  };
}

/** Shared form body for creating and editing a local pipeline schedule. */
export const JobSchedulerDialog: React.FC<IJobSchedulerDialogProps> = ({
  displayName,
  cronExpression = '0 * * * *',
  enabled = true,
  retryPolicy = {
    max_attempts: 3,
    initial_delay_seconds: 60,
    backoff_multiplier: 2
  },
  retentionPolicy = {
    max_records: 100,
    retention_days: 90
  }
}) => {
  return (
    <form className="jupyter-ml-dialog-form">
      <label htmlFor="job_name">Schedule name:</label>
      <br />
      <input
        id="job_name"
        name="display_name"
        type="text"
        defaultValue={displayName}
        data-form-required
      />
      <br />
      <br />
      <label htmlFor="job_cron">Cron expression:</label>
      <br />
      <input
        id="job_cron"
        name="cron_expression"
        type="text"
        defaultValue={cronExpression}
        data-form-required
      />
      <p className="jupyter-ml-jobScheduler-hint">
        Five fields: minute hour day-of-month month day-of-week
      </p>
      <input
        id="job_enabled"
        name="enabled"
        type="checkbox"
        className="jupyter-ml-Dialog-checkbox"
        defaultChecked={enabled}
      />
      <label htmlFor="job_enabled">Enabled</label>
      <fieldset className="jupyter-ml-jobScheduler-retry">
        <legend>Retry policy</legend>
        <label htmlFor="job_retry_attempts">Maximum attempts:</label>
        <input id="job_retry_attempts" name="retry_max_attempts" type="number" min="1" defaultValue={retryPolicy.max_attempts} />
        <label htmlFor="job_retry_delay">Initial delay (seconds):</label>
        <input id="job_retry_delay" name="retry_initial_delay_seconds" type="number" min="0" defaultValue={retryPolicy.initial_delay_seconds} />
        <label htmlFor="job_retry_backoff">Backoff multiplier:</label>
        <input id="job_retry_backoff" name="retry_backoff_multiplier" type="number" min="1" step="0.1" defaultValue={retryPolicy.backoff_multiplier} />
      </fieldset>
      <fieldset className="jupyter-ml-jobScheduler-retry">
        <legend>History retention</legend>
        <label htmlFor="job_retention_records">Maximum records:</label>
        <input id="job_retention_records" name="retention_max_records" type="number" min="1" defaultValue={retentionPolicy.max_records} />
        <label htmlFor="job_retention_days">Retention days:</label>
        <input id="job_retention_days" name="retention_days" type="number" min="1" defaultValue={retentionPolicy.retention_days} />
      </fieldset>
    </form>
  );
};
