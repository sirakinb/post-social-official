// Import this first in a Node entry point (backend/server.ts, the worker): it spreads
// SETTINGS_JSON into process.env before any other module reads a setting. Node only.
import { applySettingsJson } from "./settings-json";

applySettingsJson(process.env);
