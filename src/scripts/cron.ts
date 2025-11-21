import { getEnv } from "../config/env";
import { createGmailClient, fetchMessages, normalizeMessage, markMessageAsRead } from "../services/gmailService";
import { analyzeMail } from "../services/geminiService";
import { sendTelegramMessage } from "../services/telegramService";
import { formatTelegramMessage } from "../utils/telegramFormatter";
import { logInfo, logError } from "../utils/logger";

const run = async () => {
  logInfo("Starting Cron Job via GitHub Actions...");

  try {
    const env = getEnv();
    const gmailClient = createGmailClient(env);

    // Lấy thư chưa đọc
    const messages = await fetchMessages(gmailClient, env.gmailPollQuery, 1);

    if (messages.length === 0) {
      logInfo("No new unread emails found.");
      process.exit(0);
    }

    const latestMessage = messages[0];
    if (!latestMessage?.id) {
      logInfo("Found message but missing ID.");
      process.exit(0);
    }

    logInfo("Processing new email...", { id: latestMessage.id });

    // Xử lý
    const normalized = await normalizeMessage(latestMessage);
    const analysis = await analyzeMail(env, normalized);
    
    // Gửi Telegram
    const telegramMessage = formatTelegramMessage(analysis);
    await sendTelegramMessage(env, telegramMessage);
    
    // Đánh dấu đã đọc để không xử lý lại lần sau
    await markMessageAsRead(gmailClient, latestMessage.id);

    logInfo("Successfully processed and sent to Telegram.", { mailId: latestMessage.id });
    process.exit(0);

  } catch (error: any) {
    logError("Fatal error in Cron Job", { error: error.message });
    process.exit(1);
  }
};

run();

