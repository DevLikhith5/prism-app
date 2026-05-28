import {
  buildFloodEmailPayload,
  fetchFloodDatesJson,
  floodLastStateKey,
  getLatestFloodDate,
  resolveFloodEmailCopy,
  stripLegacyMozFloodKey,
  transformLastProcessedFlood,
} from './alert';
import { sendFloodAlertEmail } from '../utils/email';
import {
  findAllAnticipatoryActionAlertsByType,
  updateAnticipatoryActionAlert,
} from '../db/aa-queries';
import type { AAFloodAlertMetadata } from '../types/aa-flood-metadata';
import type { AnticipatoryActionAlert } from '../types/anticipatory-action-alerts';
import { TriggerStatus } from '../types/flood-email';

const args = process.argv.slice(2);
const testEmailArg = args.find((arg) => arg.startsWith('--testEmail='));
const overrideEmails: string[] = testEmailArg
  ? testEmailArg
      .split('=')[1]
      ?.split(',')
      .map((email) => email.trim())
      .filter(Boolean)
  : [];

const IS_TEST = overrideEmails.length > 0;

const TEST_ALERT_ROW: AnticipatoryActionAlert = {
  id: 1,
  country: 'Mozambique',
  type: 'flood',
  emails: overrideEmails,
  prismUrl: 'https://prism.moz.wfp.org',
  metadata: {
    floodDatesUrl:
      'https://data.earthobservation.vam.wfp.org/public-share/aa/flood/moz/dates.json',
  },
};

async function tickOneAlert(alert: AnticipatoryActionAlert): Promise<void> {
  const meta = alert.metadata as AAFloodAlertMetadata | undefined;
  const datesUrl = meta?.floodDatesUrl;
  if (!datesUrl || typeof datesUrl !== 'string') {
    console.error(
      `Skipping flood alert id=${alert.id}: metadata.floodDatesUrl missing or invalid`,
    );
    return;
  }

  const emails = IS_TEST ? overrideEmails : alert.emails;
  const dates = await fetchFloodDatesJson(datesUrl);
  const latestDate = getLatestFloodDate(dates);
  const triggerRaw = latestDate ? dates[latestDate]?.trigger_status : null;

  const touchRanOnly = async (
    nextStates: Record<string, { status: string; refTime: string }>,
  ) => {
    if (IS_TEST) {
      return;
    }
    await updateAnticipatoryActionAlert(alert.id, {
      lastStates: nextStates,
      lastRanAt: new Date(),
      lastTriggeredAt: null,
    });
  };

  if (!latestDate) {
    await touchRanOnly(stripLegacyMozFloodKey(alert.lastStates));
    return;
  }

  const lastStateKey = floodLastStateKey(alert.id);
  const lastProcessedRefTime =
    !IS_TEST &&
    (alert.lastStates?.[lastStateKey]?.refTime ??
      alert.lastStates?.moz_flood?.refTime);

  const isNewDate =
    !lastProcessedRefTime ||
    new Date(latestDate) > new Date(lastProcessedRefTime);

  if (!isNewDate) {
    await touchRanOnly(stripLegacyMozFloodKey(alert.lastStates ?? {}));
    return;
  }

  const stationSummaryFile = dates[latestDate]?.station_summary_file;
  const baseDir = datesUrl.split('?')[0].replace(/dates\.json$/i, '');
  const stationSummaryUrl = stationSummaryFile
    ? `${baseDir}${stationSummaryFile}`
    : undefined;

  const emailCopy = resolveFloodEmailCopy(alert);
  const triggerStatus = (triggerRaw || 'not exceeded') as TriggerStatus;

  const payload = await buildFloodEmailPayload(
    latestDate,
    triggerStatus,
    alert.prismUrl,
    emails,
    stationSummaryUrl,
    emailCopy,
  );

  const patch = transformLastProcessedFlood(
    latestDate,
    triggerStatus,
    lastStateKey,
  );
  const updatedLastStates = {
    ...stripLegacyMozFloodKey(alert.lastStates),
    ...patch,
  };

  if (payload) {
    await sendFloodAlertEmail(payload);
  }

  if (!IS_TEST) {
    await updateAnticipatoryActionAlert(alert.id, {
      lastStates: updatedLastStates,
      lastRanAt: new Date(),
      lastTriggeredAt: payload ? new Date() : null,
    });
  }
}

export async function run() {
  const alerts = IS_TEST ? [TEST_ALERT_ROW] : await findAllAnticipatoryActionAlertsByType('flood');

  if (!alerts.length && !IS_TEST) {
    console.error('Error: No flood alert rows in anticipatory_action_alerts');
    return;
  }

  for (const alert of alerts) {
    await tickOneAlert(alert);
  }
}
