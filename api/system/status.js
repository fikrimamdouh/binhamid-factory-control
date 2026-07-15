import { readiness } from '../_lib/config.js';
import { json, method } from '../_lib/http.js';
export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  json(res, 200, { ok: true, version: '2026.07.15-cloud-foundation-1', ...readiness() });
}
