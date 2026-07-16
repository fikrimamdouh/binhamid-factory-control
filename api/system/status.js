import { readiness } from '../_lib/config.js';
import { json, method } from '../_lib/http.js';
export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  json(res, 200, {
    ok: true,
    version: '2026.07.16-enterprise-phase-one',
    ...readiness(),
    placesConfigured: Boolean(process.env.GOOGLE_PLACES_API_KEY || process.env.PLACES_DIRECTORY_KEY),
    gpsConfigured: Boolean(process.env.GPS_API_BASE_URL && (process.env.GPS_API_TOKEN || process.env.GPS_API_USER)),
    cronConfigured: Boolean(process.env.CRON_SECRET),
    pdfConfigured: Boolean(process.env.PDF_API_URL && process.env.PDF_API_KEY),
    webhookVersion: 3,
    conversationHistory: true,
    directOperationsSchema: 4
  });
}
