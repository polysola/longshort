import { exec } from "child_process";
import { promisify } from "util";
import { logInfo, logError } from "./logger";

const execAsync = promisify(exec);

// Tự động commit và push file logs lên Git
export const autoCommitAndPushLogs = async (filePath: string): Promise<void> => {
  try {
    // 1. Git add file logs
    await execAsync(`git add ${filePath}`);
    
    // 2. Git commit với message tự động
    const timestamp = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const commitMessage = `Update logs: ${timestamp}`;
    
    try {
      await execAsync(`git commit -m "${commitMessage}"`);
    } catch (error: any) {
      // Nếu không có thay đổi gì (nothing to commit) thì bỏ qua
      if (error.message.includes('nothing to commit')) {
        logInfo("Không có thay đổi trong logs để commit.");
        return;
      }
      throw error;
    }
    
    // 3. Git push lên remote
    await execAsync('git push');
    
    logInfo("Đã tự động commit và push logs lên Git.", { file: filePath });
  } catch (error) {
    logError("Lỗi khi tự động commit/push logs lên Git.", { 
      error: (error as Error).message,
      file: filePath 
    });
  }
};

