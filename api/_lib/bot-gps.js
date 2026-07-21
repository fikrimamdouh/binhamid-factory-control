// Compatibility bridge for old Telegram callbacks and imports.
// The implementation is attendance-based fleet status only; no GPS provider,
// live location, Traccar connection, or vehicle tracking is used.
export {
  getFleetAttendanceStatus as getGpsFleet,
  sendFleetAttendanceStatus as sendGpsFleetStatus
} from './bot-fleet-status.js';
