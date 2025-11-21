import type { gmail_v1 } from "googleapis";
import { promises as fs } from "fs";
import path from "path";
import { getEnv } from "./config/env";
import type { EnvConfig } from "./config/env";
import { createGmailClient, fetchMessages, normalizeMessage, markMessageAsRead } from "./services/gmailService";
import { analyzeMail } from "./services/geminiService";
import { sendTelegramMessage } from "./services/telegramService";
import { formatTelegramMessage } from "./utils/telegramFormatter";
import type { NormalizedMail } from "./types/mail";
import { logError, logInfo, logWarn } from "./utils/logger";
import { AppError } from "./lib/errors";

const OUTPUT_PATH = path.join(process.cwd(), "logs", "latest-mails.json");
const POLLING_INTERVAL_MS = 5 * 60 * 1000; // 10 phút

// Biến lưu trạng thái ID tin nhắn mới nhất đã xử lý
let lastProcessedMsgId: string | null = null;

const processMessage = async (
  env: EnvConfig,
  gmailClient: gmail_v1.Gmail,
  message: gmail_v1.Schema$Message,
): Promise<NormalizedMail | null> => {
  if (!message.id) {
    logWarn("Bỏ qua thư vì thiếu ID.");
    return null;
  }

  try {
    logInfo("Bắt đầu xử lý thư.", { messageId: message.id });

    const normalized = normalizeMessage(message);

    // 1. Phân tích với GPT (ưu tiên HTML)
    const analysis = await analyzeMail(env, normalized);

    // 2. Format tin nhắn Telegram (có icon, entry, SL, TP)
    const telegramMessage = formatTelegramMessage(analysis);

    // 3. Gửi Telegram
    await sendTelegramMessage(env, telegramMessage);

    // 4. Đánh dấu đã đọc (tuỳ chọn, nhưng logic chính giờ dựa vào lastProcessedMsgId)
    await markMessageAsRead(gmailClient, message.id);

    logInfo("Đã xử lý & gửi Telegram thành công.", {
      messageId: message.id,
      signals: analysis.signals?.length ?? 0,
    });

    return normalized;
  } catch (error) {
    logError("Lỗi khi xử lý thư.", {
      messageId: message.id,
      error: (error as Error).message,
      details: (error as AppError).context || (error as any).cause,
    });

    return null;
  }
};

const saveMailsToFile = async (mails: NormalizedMail[]) => {
  try {
    await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await fs.writeFile(
      OUTPUT_PATH,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          total: mails.length,
          emails: mails,
        },
        null,
        2,
      ),
      "utf8",
    );

    logInfo("Đã lưu log email vào file JSON.", { file: OUTPUT_PATH });
  } catch (error) {
    logError("Không thể ghi file JSON.", { error: (error as Error).message });
  }
};

const checkNewEmails = async (env: EnvConfig, gmailClient: gmail_v1.Gmail) => {
  logInfo("Đang kiểm tra Gmail...", { query: env.gmailPollQuery });

  // CHỈ LẤY 1 THƯ MỚI NHẤT
  const messages = await fetchMessages(gmailClient, env.gmailPollQuery, 1);

  if (messages.length === 0) {
    logInfo("Không tìm thấy thư nào từ người gửi này.");
    return;
  }

  const latestMessage = messages[0];
  if (!latestMessage?.id) {
    return;
  }

  // Kiểm tra trùng lặp: Nếu ID thư này trùng với thư đã xử lý lần trước -> Bỏ qua
  if (latestMessage.id === lastProcessedMsgId) {
    logInfo("Không có thư mới. (ID thư mới nhất trùng với ID đã xử lý)", { id: latestMessage.id });
    return;
  }

  // Nếu khác ID -> Có thư mới -> Xử lý
  logInfo("Phát hiện thư mới (hoặc chạy lần đầu).", { newId: latestMessage.id, oldId: lastProcessedMsgId });

  const normalized = await processMessage(env, gmailClient, latestMessage);

  if (normalized) {
    // Cập nhật ID đã xử lý
    lastProcessedMsgId = normalized.id;
    await saveMailsToFile([normalized]);
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
  try {
    const env = getEnv();
    const gmailClient = createGmailClient(env);

    logInfo(`Bắt đầu ứng dụng. Chu kỳ kiểm tra: ${POLLING_INTERVAL_MS / 60000} phút.`);
    logInfo("Lưu ý: Lần chạy đầu tiên sẽ luôn xử lý mail mới nhất tìm thấy.");

    // Chạy vòng lặp vô tận
    while (true) {
      await checkNewEmails(env, gmailClient);
      
      logInfo(`Đang chờ ${POLLING_INTERVAL_MS / 60000} phút cho lần kiểm tra tiếp theo...`);
      await sleep(POLLING_INTERVAL_MS);
    }

  } catch (error) {
    if (error instanceof AppError) {
      logError("Ứng dụng lỗi fatal.", {
        type: error.name,
        details: error.message,
        context: error.context,
      });
    } else {
      logError("Lỗi không xác định (Fatal).", { error: (error as Error).message });
    }
    process.exit(1);
  }
};

void main();
