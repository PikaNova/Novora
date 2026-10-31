import { runAutomaticBackup } from '../api/_backup/service.js';

async function run() {
  try {
    const result = await runAutomaticBackup();
    if ('id' in result) console.info('Automatic backup completed');
  } catch {
    console.error('Automatic backup failed; check storage and database configuration');
  }
}

void run();
setInterval(() => void run(), 15 * 60_000);
