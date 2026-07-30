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

interface ILocalScheduleDialogProps {
  displayName: string;
  cronExpression?: string;
  enabled?: boolean;
}

/** Shared form body for creating and editing a local pipeline schedule. */
export const LocalScheduleDialog: React.FC<ILocalScheduleDialogProps> = ({
  displayName,
  cronExpression = '0 * * * *',
  enabled = true
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
    </form>
  );
};
