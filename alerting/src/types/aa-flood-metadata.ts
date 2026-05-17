/**
 * Optional JSON on `anticipatory_action_alerts.metadata` for type=flood rows.
 * `floodDatesUrl` must point at `dates.json` (same contract as the PRISM frontend).
 */
export type AAFloodAlertMetadata = {
  floodDatesUrl?: string;
  countryDisplayName?: string;
  forecastLeadDaysMin?: number;
  forecastLeadDaysMax?: number;
  /** Shown after em dash, e.g. "forecast by GloFAS with data processing by WFP" */
  forecastAttributionLine?: string;
  /** HTML snippet inserted after "made and communicated by" (may include <strong>…</strong>) */
  disclaimerAuthorityHtml?: string;
  /** Plain-text disclaimer authority (multipart/alternative); defaults to stripped HTML */
  disclaimerAuthorityPlain?: string;
  /** Used for map image alt text */
  mapAltCountry?: string;
};
