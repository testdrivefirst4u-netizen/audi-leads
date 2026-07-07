const cron = require("node-cron");
const { runSync, getSettings } = require("./syncService");

let task = null;
let currentInterval = null;

function cronExpressionForMinutes(minutes) {
  return `*/${minutes} * * * *`;
}

function scheduleTask(minutes, io) {
  if (task) task.stop();
  currentInterval = minutes;
  task = cron.schedule(cronExpressionForMinutes(minutes), () => {
    runSync(io).catch((err) => console.error("[cron] sync failed:", err));
  });
  console.log(`[cron] Sync scheduled every ${minutes} minute(s)`);
}

// Boots the recurring sync job and watches Settings for interval changes so
// the admin's choice on the Settings page takes effect without a restart.
async function startScheduler(io) {
  const settings = await getSettings();
  scheduleTask(settings.syncIntervalMinutes, io);

  runSync(io).catch((err) => console.error("[cron] initial sync failed:", err));

  setInterval(async () => {
    try {
      const latest = await getSettings();
      if (latest.syncIntervalMinutes !== currentInterval) {
        scheduleTask(latest.syncIntervalMinutes, io);
      }
    } catch (err) {
      console.error("[cron] failed to check settings:", err);
    }
  }, 15000);
}

module.exports = { startScheduler };
