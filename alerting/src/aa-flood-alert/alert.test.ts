import {
  floodLastStateKey,
  forecastLeadDaysPhrase,
  resolveFloodEmailCopy,
  stripLegacyMozFloodKey,
  transformLastProcessedFlood,
} from './alert';

describe('AA flood alert helpers', () => {
  it('forecastLeadDaysPhrase', () => {
    expect(forecastLeadDaysPhrase(3, 5)).toBe('3 to 5');
    expect(forecastLeadDaysPhrase(7, 7)).toBe('7');
  });

  it('stripLegacyMozFloodKey removes moz_flood only', () => {
    expect(stripLegacyMozFloodKey({ moz_flood: { status: 'x', refTime: '2025-01-01' } })).toEqual(
      {},
    );
    expect(
      stripLegacyMozFloodKey({
        moz_flood: { status: 'x', refTime: 'a' },
        flood_alert_2: { status: 'y', refTime: 'b' },
      }),
    ).toEqual({ flood_alert_2: { status: 'y', refTime: 'b' } });
  });

  it('transformLastProcessedFlood uses dynamic key', () => {
    expect(transformLastProcessedFlood('2025-02-02', 'moderate', 'flood_alert_9')).toEqual({
      flood_alert_9: { status: 'moderate', refTime: '2025-02-02' },
    });
  });

  it('floodLastStateKey', () => {
    expect(floodLastStateKey(42)).toBe('flood_alert_42');
  });

  it('resolveFloodEmailCopy uses defaults', () => {
    const copy = resolveFloodEmailCopy({ country: 'mozambique', metadata: {} });
    expect(copy.countryDisplayName).toBe('mozambique');
    expect(copy.forecastLeadDaysPhrase).toBe('3 to 5');
    expect(copy.forecastAttributionLine).toContain('GloFAS');
    expect(copy.disclaimerAuthorityHtml).toContain('INGD');
    expect(copy.disclaimerAuthorityPlain).toContain('INGD');
    expect(copy.disclaimerAuthorityPlain).not.toContain('<strong>');
    expect(copy.mapAltCountry).toBe('mozambique');
  });

  it('resolveFloodEmailCopy respects metadata overrides', () => {
    const copy = resolveFloodEmailCopy({
      country: 'XYZ',
      metadata: {
        countryDisplayName: 'Republic of XYZ',
        forecastLeadDaysMin: 2,
        forecastLeadDaysMax: 4,
        forecastAttributionLine: 'forecast by ExampleHydrology',
        disclaimerAuthorityHtml: '<strong>National DRM Agency</strong>',
        disclaimerAuthorityPlain: 'National DRM Agency (plain)',
        mapAltCountry: 'XYZ map label',
      },
    });
    expect(copy.countryDisplayName).toBe('Republic of XYZ');
    expect(copy.forecastLeadDaysPhrase).toBe('2 to 4');
    expect(copy.forecastAttributionLine).toBe('forecast by ExampleHydrology');
    expect(copy.disclaimerAuthorityPlain).toBe('National DRM Agency (plain)');
    expect(copy.mapAltCountry).toBe('XYZ map label');
  });
});
