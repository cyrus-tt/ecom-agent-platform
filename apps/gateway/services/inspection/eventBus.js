"use strict";

/**
 * Event bus — broadcasts inspection events to connected SSE clients.
 *
 * When the inspection completes or a critical anomaly is found,
 * the bus pushes notifications to any connected browser tabs.
 * This enables real-time dashboard updates without polling.
 */

const clients = new Set();

function addClient(res) {
  clients.add(res);
  res.on("close", () => clients.delete(res));
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch (_) {
      clients.delete(client);
    }
  }
}

function notifyInspectionComplete(result) {
  broadcast("inspection_complete", {
    anomaly_count: result.anomaly_count,
    summary: result.summary,
    timestamp: new Date().toISOString(),
  });
}

function notifyCriticalAnomaly(anomaly) {
  broadcast("critical_anomaly", {
    title: anomaly.title,
    severity: anomaly.severity,
    change_pct: anomaly.change_pct,
    timestamp: new Date().toISOString(),
  });
}

function notifyProposalPending(count) {
  broadcast("proposals_pending", {
    count,
    timestamp: new Date().toISOString(),
  });
}

function getClientCount() {
  return clients.size;
}

module.exports = {
  addClient,
  broadcast,
  notifyInspectionComplete,
  notifyCriticalAnomaly,
  notifyProposalPending,
  getClientCount,
};
