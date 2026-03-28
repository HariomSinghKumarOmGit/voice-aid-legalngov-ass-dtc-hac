import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const autoCommitAndPush = async () => {
  try {
    // 1. Check if there are any changes (modified, deleted, or un-tracked files)
    const { stdout: statusOut } = await execAsync('git status --porcelain');
    
    if (!statusOut.trim()) {
      console.log(`[${new Date().toLocaleString()}] No changes found. Skipping push.`);
      return;
    }

    // 2. Changes found! Let's get the timestamp and commit them
    const timeStamp = new Date().toLocaleString();
    console.log(`[${timeStamp}] Changes detected! Committing and pushing...`);
    
    await execAsync('git add .');
    await execAsync(`git commit -m "Auto-commit: ${timeStamp}"`);
    await execAsync('git push');
    
    console.log(`[${new Date().toLocaleString()}] ✅ Successfully pushed to GitHub!`);
  } catch (error) {
    console.error(`[${new Date().toLocaleString()}] ❌ Error during git operation:`, error.message);
  }
};

// Start the first check immediately
autoCommitAndPush();

// Set it up to run every 5 minutes (5 * 60 * 1000 milliseconds)
setInterval(autoCommitAndPush, 5 * 60 * 1000);

console.log('🚀 Auto-Git-Pusher started! Scanning for new code every 5 minutes...');