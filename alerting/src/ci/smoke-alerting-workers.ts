/**
 * Run threshold alert-worker and AA listing queries against a real pg pool.
 * Safe on an empty database: no outbound hazard fetches when there are no active alerts.
 */
import { runAlertWorker } from '../alert-worker';
import { closePool } from '../db/pool';
import { findAnticipatoryActionAlerts, findAllAnticipatoryActionAlertsByType } from '../db/aa-queries';

async function main(): Promise<void> {
  await findAnticipatoryActionAlerts('Mozambique', 'storm');
  await findAnticipatoryActionAlerts('Mozambique', 'flood');
  await findAllAnticipatoryActionAlertsByType('flood');
  await runAlertWorker();
  await closePool();
  console.log('Alerting worker smoke OK (threshold + AA storm + AA flood list)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
