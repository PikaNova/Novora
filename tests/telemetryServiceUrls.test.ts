import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeServiceBase, resolveTelemetryUrls, telemetryConfig } from '../api/_telemetryConfig.js';

const base = telemetryConfig.baseUrl;
const envUrl = (key: string) => (process.env[key] || '').trim();

test('未下发覆盖时，各路由回落到内置基址', () => {
  const urls = resolveTelemetryUrls();
  assert.equal(urls.collectUrl, envUrl('TELEMETRY_COLLECT_URL') || `${base}/api/collect`);
  assert.equal(urls.announceUrl, envUrl('TELEMETRY_ANNOUNCE_URL') || `${base}/api/public-announcements`);
  assert.equal(urls.errorReportUrl, envUrl('TELEMETRY_ERROR_REPORT_URL') || `${base}/api/error-report`);
  assert.equal(urls.tokenUrl, envUrl('TELEMETRY_TOKEN_URL') || `${base}/api/issue-client-token`);
  assert.equal(urls.updateUrl, envUrl('TELEMETRY_UPDATE_URL') || `${base}/api/releases/latest.json`);
  assert.equal(urls.imagesUrl, envUrl('TELEMETRY_IMAGES_URL') || `${base}/api/announcement-images`);
  assert.equal(urls.diagnosticUrl, envUrl('TELEMETRY_DIAGNOSTIC_URL') || `${base}/api/diagnostic-log-bundles`);
});

test('服务基址覆盖只影响对应路由', () => {
  const urls = resolveTelemetryUrls({
    updateBaseUrl: 'https://update.pikachu2026.space',
    ingestBaseUrl: 'https://telemetry.pikachu2026.space',
    contentBaseUrl: 'https://content.pikachu2026.space',
  });
  const ingest = 'https://telemetry.pikachu2026.space';
  assert.equal(
    urls.updateUrl,
    envUrl('TELEMETRY_UPDATE_URL') || 'https://update.pikachu2026.space/api/releases/latest.json',
  );
  assert.equal(urls.collectUrl, envUrl('TELEMETRY_COLLECT_URL') || `${ingest}/api/collect`);
  assert.equal(urls.errorReportUrl, envUrl('TELEMETRY_ERROR_REPORT_URL') || `${ingest}/api/error-report`);
  assert.equal(urls.tokenUrl, envUrl('TELEMETRY_TOKEN_URL') || `${ingest}/api/issue-client-token`);
  assert.equal(urls.diagnosticUrl, envUrl('TELEMETRY_DIAGNOSTIC_URL') || `${ingest}/api/diagnostic-log-bundles`);
  assert.equal(
    urls.announceUrl,
    envUrl('TELEMETRY_ANNOUNCE_URL') || 'https://content.pikachu2026.space/api/public-announcements',
  );
  assert.equal(
    urls.imagesUrl,
    envUrl('TELEMETRY_IMAGES_URL') || 'https://content.pikachu2026.space/api/announcement-images',
  );
});

test('非法基址被拒绝并回落', () => {
  assert.equal(normalizeServiceBase('http://update.pikachu2026.space'), '');
  assert.equal(normalizeServiceBase('https://update.pikachu2026.space/path'), '');
  assert.equal(normalizeServiceBase('https://user:pass@update.pikachu2026.space'), '');
  assert.equal(normalizeServiceBase('https://update.pikachu2026.space?x=1'), '');
  assert.equal(normalizeServiceBase('not a url'), '');
  assert.equal(normalizeServiceBase(' https://update.pikachu2026.space/ '), 'https://update.pikachu2026.space');
  const urls = resolveTelemetryUrls({ updateBaseUrl: 'http://insecure.example' });
  assert.equal(urls.updateUrl, envUrl('TELEMETRY_UPDATE_URL') || `${base}/api/releases/latest.json`);
});
