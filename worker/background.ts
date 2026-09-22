import { deliverHostAnnouncement, retryHostAnnouncements } from '../lib/notifications';
import { processMarketing } from "../lib/marketing-delivery";
import { processOrganizerReports } from "../lib/organizer-reports";
import { processPendingOrganizerAccess } from "../lib/organizer-invitations";
import { runPreviewCleanup } from "../lib/preview-cleanup";
import { processEventAnnouncements } from "../lib/event-audience";
import { deliverQueuedEventAnnouncement } from "../lib/event-announcement-queue";
import { retryEventRemovals } from "../lib/event-removal";
import { retryOrderConfirmations, deliverOrderConfirmationByReference } from '../lib/payment-operations';
import { processRegistrations } from "../lib/registrations";
import { recoverSeevPayments } from "../lib/seevplus";
import { expireReservations, runDailyReconciliation } from "../lib/payment-operations";
import { retryFailedDeliveries, sendOperationalAlert } from "../lib/email-delivery";
import { processRefundBatches } from "../lib/operational-finance";
import { refreshExpiredPreviewEvents } from "../lib/preview-events";
import { purgeExpiredFlashes } from "../lib/flashes";
import { recoverAbandonedPayments, releaseWaitlistOffers } from "../lib/sales-recovery";

export async function processQueue(batch: MessageBatch<{ deliveryId: string }>, env: Cloudflare.Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        if (message.body?.deliveryId === "marketing-sync") await processMarketing(env);
        else if (message.body?.deliveryId?.startsWith('host-announcement:')) await deliverHostAnnouncement(env, message.body.deliveryId.slice('host-announcement:'.length));
        else if (message.body?.deliveryId === "organizer-reports:tick") await processOrganizerReports(env.DB);
        else if (message.body?.deliveryId?.startsWith('registration-confirmation:')) await processRegistrations(env, 'https://tickets.becoreops.com', message.body.deliveryId.slice('registration-confirmation:'.length));
        else if (message.body?.deliveryId?.startsWith('order-confirmation:')) await deliverOrderConfirmationByReference(env, message.body.deliveryId.slice('order-confirmation:'.length), 'https://tickets.becoreops.com');
        else await deliverQueuedEventAnnouncement(env, message.body?.deliveryId ?? "");
        message.ack();
      } catch (error) {
        console.error(JSON.stringify({
          message: "queued delivery task failed",
          deliveryId: message.body?.deliveryId ?? null,
          error: error instanceof Error ? error.message : String(error),
        }));
        message.retry({ delaySeconds: 60 });
      }
    }
  }

async function recordSystemAlert(env: Cloudflare.Env, source: string, error: unknown): Promise<void> {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ message: "scheduled operation failed", source, error: detail }));
  try { await sendOperationalAlert(env, { source, severity: "critical", message: `${source} failed`, detail }); } catch { console.error(JSON.stringify({message:"Could not save operational alert",source})); }
}

export async function runScheduledOperations(controller: ScheduledController, env: Cloudflare.Env): Promise<void> {
  if (env.ENVIRONMENT === "production") { try { await runPreviewCleanup(env); } catch (error) { await recordSystemAlert(env, "preview-cleanup", error); } }
  if(controller.cron === "* * * * *"){try { if (new Date(controller.scheduledTime).getUTCMinutes() % 2 === 0) await processMarketing(env); else await processEventAnnouncements(env,"https://tickets.becoreops.com"); } catch(error) { await recordSystemAlert(env,"event-announcements",error); } return;}
  try { await retryEventRemovals(env); } catch (error) { await recordSystemAlert(env, "event-removal-cleanup", error); }
  try { await retryHostAnnouncements(env); } catch (error) { await recordSystemAlert(env, 'host-announcements', error); }
  try { await retryOrderConfirmations(env, "https://tickets.becoreops.com"); } catch (error) { await recordSystemAlert(env, "order-confirmations", error); }
  try { await processRegistrations(env, "https://tickets.becoreops.com"); } catch (error) { await recordSystemAlert(env, "event-registrations", error); }
  try {
    await purgeExpiredFlashes(env.DB);
  } catch (error) {
    await recordSystemAlert(env, "flash-expiry", error);
  }
  try {
    await expireReservations(env.DB);
  } catch (error) {
    await recordSystemAlert(env, "reservation-expiry", error);
  }
  try {
    await releaseWaitlistOffers(env, "https://tickets.becoreops.com");
  } catch (error) {
    await recordSystemAlert(env, "waitlist-offers", error);
  }
  try {
    if (new Date(controller.scheduledTime).getUTCHours() < 8) { /* Reports begin at 8am Accra time. */ }
    else if (env.EMAIL_DELIVERY_QUEUE) await env.EMAIL_DELIVERY_QUEUE.send({ deliveryId:"organizer-reports:tick" });
    else if (env.ENVIRONMENT !== "production") await processOrganizerReports(env.DB);
    else throw new Error("Host report queue is not configured.");
  } catch (error) {
    await recordSystemAlert(env, "organizer-reports", error);
  }
  try {
    await processPendingOrganizerAccess(env.DB);
    await retryFailedDeliveries(env, 20, 'standard');
  } catch (error) {
    await recordSystemAlert(env, "email-delivery-retry", error);
  }
  if (env.PAYSTACK_SECRET_KEY) {
    try {
      await processRefundBatches(env);
    } catch (error) {
      await recordSystemAlert(env, "approved-refund-batch", error);
    }
  }
  try {
    const recovery = await recoverSeevPayments(env, "https://tickets.becoreops.com");
    if (recovery.failed) throw new Error(`${recovery.failed} SeevPlus payments need verification; review order records.`);
  } catch (error) {
    await recordSystemAlert(env, "seevplus-payment-recovery", error);
  }
  if (env.PAYSTACK_SECRET_KEY) {
    try {
      await recoverAbandonedPayments(env, "https://tickets.becoreops.com");
    } catch (error) {
      await recordSystemAlert(env, "abandoned-payment-recovery", error);
    }
  }
  if (controller.cron === "15 3 * * *") {
    try {
      if (env.ENVIRONMENT !== "production") await refreshExpiredPreviewEvents(env.DB);
    } catch (error) {
      await recordSystemAlert(env, "preview-event-rollover", error);
    }
  }
  if (controller.cron === "15 3 * * *") {
    try {
      await env.DB.prepare("DELETE FROM product_metrics_daily WHERE day < date('now', '-180 days')").run();
    } catch (error) {
      await recordSystemAlert(env, "analytics-retention", error);
    }
  }
  if (controller.cron === "15 3 * * *" && env.PAYSTACK_SECRET_KEY) {
    try {
      const periodEnd = new Date();
      periodEnd.setUTCHours(0, 0, 0, 0);
      const periodStart = new Date(periodEnd.getTime() - 24 * 60 * 60 * 1000);
      await runDailyReconciliation(env.DB, { secret: env.PAYSTACK_SECRET_KEY, periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(), actor: "system:daily-reconciliation" });
    } catch (error) {
      await recordSystemAlert(env, "daily-payment-reconciliation", error);
    }
  }
}

