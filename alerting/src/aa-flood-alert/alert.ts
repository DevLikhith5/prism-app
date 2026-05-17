import nodeFetch from 'node-fetch';
import { captureScreenshotFromUrl } from '../utils/capture-utils';
import { formatDate } from '../utils/date';
import type { AnticipatoryActionAlert } from '../types/anticipatory-action-alerts';
import type { AAFloodAlertMetadata } from '../types/aa-flood-metadata';
import {
  FloodAlertEmailData,
  TRIGGER_STATUSES,
  TriggerStatus,
} from '../types/flood-email';

// @ts-ignore
global.fetch = nodeFetch;

type DatesJsonEntry = {
  trigger_status?: TriggerStatus;
  probabilities_file?: string;
  discharge_file?: string;
  avg_probabilities_file?: string;
  station_summary_file?: string;
};

type StationSummaryEntry = {
  station_name: string;
  station_id: number | string;
  river_name?: string;
  trigger_status?: string;
};

function transformStationName(name: string): string {
  return name
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export async function fetchFloodDatesJson(
  url: string,
): Promise<Record<string, DatesJsonEntry>> {
  try {
    const resp = await fetch(url);
    return await resp.json();
  } catch (e) {
    console.error('Error fetching flood dates.json', e);
    return {} as Record<string, DatesJsonEntry>;
  }
}

export function getLatestFloodDate(
  dates: Record<string, DatesJsonEntry>,
): string | null {
  const dateKeys = Object.keys(dates || {});
  if (!dateKeys.length) return null;
  return dateKeys.reduce((latest, current) =>
    new Date(current) > new Date(latest) ? current : latest,
  );
}

export async function fetchStationSummary(
  url: string,
): Promise<StationSummaryEntry[]> {
  try {
    const resp = await fetch(url);
    const data = await resp.text();
    // Parse CSV data
    const lines = data.trim().split('\n');
    const headers = lines[0].split(',').map((h) => h.trim());
    const stations: StationSummaryEntry[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map((v) => v.trim());
      const entry: Record<string, string> = {};
      headers.forEach((header, idx) => {
        entry[header] = values[idx] || '';
      });

      if (entry.station_name) {
        stations.push({
          station_name: transformStationName(entry.station_name),
          station_id: entry.station_id || '',
          river_name: entry.river_name,
          trigger_status: entry.trigger_status,
        });
      }
    }
    return stations;
  } catch (e) {
    console.error('Error fetching station summary', e);
    return [];
  }
}

export function shouldSendFloodEmail(trigger?: string): boolean {
  if (!trigger) return false;
  // exclude 'not exceeded' status
  return (
    TRIGGER_STATUSES.includes(trigger as TriggerStatus) &&
    trigger !== 'not exceeded'
  );
}

export function floodLastStateKey(alertId: number): string {
  return `flood_alert_${alertId}`;
}

/** Drops legacy single-country cursor key when migrating to `flood_alert_<id>`. */
export function stripLegacyMozFloodKey(
  prev?: Record<string, { status: string; refTime: string }>,
): Record<string, { status: string; refTime: string }> {
  if (!prev) {
    return {};
  }
  const rest = { ...prev };
  delete rest.moz_flood;
  return rest;
}

export function forecastLeadDaysPhrase(min: number, max: number): string {
  if (min === max) {
    return String(min);
  }
  return `${min} to ${max}`;
}

export type ResolvedFloodEmailCopy = Pick<
  FloodAlertEmailData,
  | 'countryDisplayName'
  | 'forecastLeadDaysPhrase'
  | 'forecastAttributionLine'
  | 'disclaimerAuthorityHtml'
  | 'disclaimerAuthorityPlain'
  | 'mapAltCountry'
>;

const DEFAULT_FORECAST_ATTRIBUTION =
  'forecast by GloFAS with data processing by WFP';

const DEFAULT_DISCLAIMER_AUTHORITY_HTML =
  '<strong>INGD (Instituto Nacional de Gestão e Redução do Risco de Desastres)</strong>';

const DEFAULT_DISCLAIMER_AUTHORITY_PLAIN =
  'INGD (Instituto Nacional de Gestão e Redução do Risco de Desastres)';

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

export function resolveFloodEmailCopy(
  alert: Pick<AnticipatoryActionAlert, 'country' | 'metadata'>,
): ResolvedFloodEmailCopy {
  const m = (alert.metadata || {}) as AAFloodAlertMetadata;
  const min = m.forecastLeadDaysMin ?? 3;
  const max = m.forecastLeadDaysMax ?? 5;
  const countryDisplayName =
    (typeof m.countryDisplayName === 'string' && m.countryDisplayName) ||
    alert.country;
  const disclaimerAuthorityHtml =
    (typeof m.disclaimerAuthorityHtml === 'string' &&
      m.disclaimerAuthorityHtml) ||
    DEFAULT_DISCLAIMER_AUTHORITY_HTML;
  const disclaimerAuthorityPlain =
    (typeof m.disclaimerAuthorityPlain === 'string' &&
      m.disclaimerAuthorityPlain) ||
    stripHtmlTags(disclaimerAuthorityHtml) ||
    DEFAULT_DISCLAIMER_AUTHORITY_PLAIN;
  return {
    countryDisplayName,
    forecastLeadDaysPhrase: forecastLeadDaysPhrase(min, max),
    forecastAttributionLine:
      (typeof m.forecastAttributionLine === 'string' &&
        m.forecastAttributionLine) ||
      DEFAULT_FORECAST_ATTRIBUTION,
    disclaimerAuthorityHtml,
    disclaimerAuthorityPlain,
    mapAltCountry:
      (typeof m.mapAltCountry === 'string' && m.mapAltCountry) ||
      countryDisplayName,
  };
}

export function transformLastProcessedFlood(
  date: string,
  trigger: string,
  lastStateKey: string,
): Record<string, { status: string; refTime: string }> {
  return {
    [lastStateKey]: { status: trigger, refTime: date },
  };
}

export function buildFloodPrismUrl(basicUrl: string, dateIso: string) {
  const reportDate = formatDate(dateIso, 'YYYY-MM-DD');
  return new URL(
    `?hazardLayerIds=anticipatory_action_flood&date=${reportDate}`,
    basicUrl,
  ).toString();
}

export async function buildFloodEmailPayload(
  dateIso: string,
  triggerStatus: TriggerStatus,
  basicPrismUrl: string,
  emails: string[],
  stationSummaryUrl: string | undefined,
  copy: ResolvedFloodEmailCopy,
): Promise<FloodAlertEmailData | null> {
  if (!shouldSendFloodEmail(triggerStatus)) return null;

  const redirectUrl = buildFloodPrismUrl(basicPrismUrl, dateIso);
  const base64Image = await captureScreenshotFromUrl({
    url: redirectUrl,
    elementsToHide: ['.MuiDrawer-root', '.MuiList-root', '.MuiGrid-root'],
    crop: { x: 900, y: 50, width: 1000, height: 950 },
  });

  // Format date as DD-Month-YYYY for title
  const formattedDate = formatDate(dateIso, 'DD-Month-YYYY');
  const title = `Flood Anticipatory Actions Trigger detected in ${copy.countryDisplayName} (${formattedDate})`;

  // Fetch station data if available
  let stations: FloodAlertEmailData['stations'] = [];
  let stationsByStatus: Record<string, string[]> = {};

  if (stationSummaryUrl) {
    const stationData = await fetchStationSummary(stationSummaryUrl);
    stations = stationData.map((station) => ({
      name: station.station_name,
      id: station.station_id,
      river: station.river_name,
    }));

    // Group stations by trigger status, ordered from most severe to least severe
    const severityOrder = [...TRIGGER_STATUSES].reverse();
    stationsByStatus = {};

    stationData.forEach((station) => {
      if (station.trigger_status && station.trigger_status !== 'not exceeded') {
        const status = station.trigger_status.toLowerCase();
        if (!stationsByStatus[status]) {
          stationsByStatus[status] = [];
        }
        stationsByStatus[status].push(station.station_name);
      }
    });

    // Sort the statuses by severity
    const sortedStatuses: Record<string, string[]> = {};
    severityOrder.forEach((status) => {
      if (stationsByStatus[status]) {
        sortedStatuses[status] = stationsByStatus[status];
      }
    });
    stationsByStatus = sortedStatuses;
  }

  return {
    email: emails,
    title,
    triggerStatus,
    date: dateIso,
    stations,
    stationsByStatus,
    redirectUrl,
    base64Image,
    ...copy,
  };
}
