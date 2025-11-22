import type { gmail_v1 } from "googleapis";
import { promises as fs } from "fs";
import path from "path";
import { getEnv } from "./config/env";
import type { EnvConfig } from "./config/env";
import { createGmailClient, fetchMessages, normalizeMessage, markMessageAsRead } from "./services/gmailService";
import { analyzeMail } from "./services/geminiService";
import { sendTelegramMessage, getTelegramUpdates } from "./services/telegramService";
import { answerQuestion, formatBotReply } from "./services/chatbotService";
import { formatTelegramMessage } from "./utils/telegramFormatter";
import type { NormalizedMail } from "./types/mail";
import { logError, logInfo, logWarn } from "./utils/logger";
import { autoCommitAndPushLogs } from "./utils/gitHelper";
import { AppError } from "./lib/errors";

const OUTPUT_PATH = path.join(process.cwd(), "logs", "latest-mails.json");
const POLLING_INTERVAL_MS = 10 * 60 * 1000; // 10 phút

// Biến lưu trạng thái ID tin nhắn mới nhất đã xử lý
let lastProcessedMsgId: string | null = null;
let lastTelegramUpdateId: number = 0; // Offset cho Telegram updates

const processMessage = async (
  env: EnvConfig,
  gmailClient: gmail_v1.Gmail,
  message: gmail_v1.Schema$Message,
): Promise<NormalizedMail | null> => {
  if (!message.id || !message.internalDate) {
    logWarn("Bỏ qua thư vì thiếu ID hoặc date.");
    return null;
  }

  try {
    const mailTimestamp = parseInt(message.internalDate);
    const mailDate = new Date(mailTimestamp);
    const now = new Date();
    const diffMinutes = Math.floor((now.getTime() - mailTimestamp) / (1000 * 60));

    logInfo("Bắt đầu xử lý thư.", { 
      messageId: message.id,
      receivedAt: mailDate.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      ageMinutes: diffMinutes
    });

    const normalized = normalizeMessage(message);

    // 1. Phân tích với Gemini
    const analysis = await analyzeMail(env, normalized);

    // 2. Format tin nhắn Telegram với thời gian chi tiết
    const mailTimeString = mailDate.toLocaleString('vi-VN', { 
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    const separator = `\n━━━━━━━━━━━━━━━━━━━━━━\n📧 *Mail nhận lúc:* ${mailTimeString}\n⏰ *Xử lý lúc:* ${now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}\n━━━━━━━━━━━━━━━━━━━━━━\n`;
    
    const baseMessage = formatTelegramMessage(analysis);
    const finalMessage = separator + baseMessage;

    // 3. Gửi Telegram
    await sendTelegramMessage(env, finalMessage);

    // 4. Đánh dấu đã đọc
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

    // Tự động commit và push file logs lên Git
    await autoCommitAndPushLogs(OUTPUT_PATH);
    
  } catch (error) {
    logError("Không thể ghi file JSON.", { error: (error as Error).message });
  }
};

// Lấy mail mới nhất trực tiếp từ Gmail (không qua file)
const getLatestMailFromGmail = async (gmailClient: gmail_v1.Gmail): Promise<NormalizedMail | null> => {
  try {
    const query = "from:noti@vaibb.com";
    const messages = await fetchMessages(gmailClient, query, 10);

    if (messages.length === 0) {
      return null;
    }

    // Sắp xếp theo internalDate GIẢM DẦN (mail mới nhất lên đầu)
    const sortedMessages = messages.sort((a, b) => {
      const dateA = parseInt(a.internalDate || "0");
      const dateB = parseInt(b.internalDate || "0");
      return dateB - dateA;
    });

    const latestMessage = sortedMessages[0];
    
    if (!latestMessage?.id) {
      return null;
    }

    // Normalize mail để trả về
    const normalized = normalizeMessage(latestMessage);
    return normalized;
    
  } catch (error) {
    logError("Không thể lấy mail mới nhất từ Gmail.", { error: (error as Error).message });
    return null;
  }
};

const checkNewEmails = async (env: EnvConfig, gmailClient: gmail_v1.Gmail) => {
  logInfo("Đang kiểm tra Gmail...");

  // Lấy nhiều thư để có thể sort chính xác
  const query = "from:noti@vaibb.com";
  const messages = await fetchMessages(gmailClient, query, 10);

  if (messages.length === 0) {
    logInfo("Không tìm thấy thư nào từ người gửi này.");
    return;
  }

  // Sắp xếp theo internalDate GIẢM DẦN (mail mới nhất lên đầu)
  const sortedMessages = messages.sort((a, b) => {
    const dateA = parseInt(a.internalDate || "0");
    const dateB = parseInt(b.internalDate || "0");
    return dateB - dateA; // Mail mới hơn lên trước
  });

  const latestMessage = sortedMessages[0];
  
  if (!latestMessage?.id || !latestMessage.internalDate) {
    logWarn("Mail mới nhất thiếu ID hoặc timestamp.");
    return;
  }

  // Log thông tin mail mới nhất
  const mailTimestamp = parseInt(latestMessage.internalDate);
  const mailDate = new Date(mailTimestamp);
  const diffMinutes = Math.floor((Date.now() - mailTimestamp) / (1000 * 60));

  logInfo("Mail mới nhất tìm thấy:", {
    id: latestMessage.id,
    receivedAt: mailDate.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
    ageMinutes: diffMinutes
  });

  // Kiểm tra trùng lặp: Nếu ID thư này trùng với thư đã xử lý lần trước -> Bỏ qua
  if (latestMessage.id === lastProcessedMsgId) {
    logInfo("Không có thư mới. (ID thư mới nhất trùng với ID đã xử lý)", { id: latestMessage.id });
    return;
  }

  // Kiểm tra trạng thái đã đọc
  const thread = await gmailClient.users.messages.get({
    userId: 'me',
    id: latestMessage.id,
    format: 'minimal' 
  });

  const isUnread = thread.data.labelIds?.includes('UNREAD');

  if (!isUnread) {
    // Nếu mail đã đọc nhưng chưa xử lý (ví dụ do restart app), kiểm tra tuổi
    if (diffMinutes > 20) {
      logInfo(`Mail mới nhất đã đọc và quá cũ (${diffMinutes} phút). Bỏ qua.`);
      return;
    } else {
      logInfo(`Mail mới nhất đã đọc nhưng còn mới (${diffMinutes} phút). Tiếp tục xử lý...`);
    }
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

// Xử lý tin nhắn từ Telegram (Chatbot)
const handleTelegramMessages = async (env: EnvConfig, gmailClient: gmail_v1.Gmail) => {
  try {
    const updates = await getTelegramUpdates(env, lastTelegramUpdateId);

    if (updates.length === 0) {
      return;
    }

    for (const update of updates) {
      // Cập nhật offset
      lastTelegramUpdateId = update.update_id + 1;

      // Chỉ xử lý tin nhắn text
      if (!update.message || !update.message.text) {
        continue;
      }

      const userMessage = update.message.text;
      const chatId = update.message.chat.id;

      // Kiểm tra xem có phải chat đúng không
      if (chatId.toString() !== env.telegramChatId) {
        logWarn("Nhận tin nhắn từ chat ID không đúng. Bỏ qua.", { chatId });
        continue;
      }

      logInfo("Nhận câu hỏi từ người dùng:", { question: userMessage });

      // Gửi tin nhắn "đang xử lý" ngay lập tức với format đẹp
      const processingMsg = `
🔄 *ĐANG XỬ LÝ...*

📥 Đang lấy email mới nhất từ Gmail
🤖 Đang phân tích dữ liệu với AI
⏱️ Vui lòng đợi trong giây lát...
`;
      await sendTelegramMessage(env, processingMsg);

      // Lấy mail mới nhất trực tiếp từ Gmail
      const latestMail = await getLatestMailFromGmail(gmailClient);

      if (!latestMail) {
        const errorMsg = `
❌ *KHÔNG TÌM THẤY DỮ LIỆU*

Không có email nào từ noti@vaibb.com trong hộp thư.
Vui lòng thử lại sau hoặc kiểm tra nguồn email.
`;
        await sendTelegramMessage(env, errorMsg);
        continue;
      }

      // Trả lời dựa trên mail mới nhất
      const answer = await answerQuestion(env, userMessage, latestMail);

      // Format mail date
      const mailDate = new Date(latestMail.date).toLocaleString('vi-VN', { 
        timeZone: 'Asia/Ho_Chi_Minh',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });

      // Gửi trả lời với format đẹp
      const formattedReply = formatBotReply(answer, mailDate);
      await sendTelegramMessage(env, formattedReply);

    }
  } catch (error) {
    logError("Lỗi khi xử lý tin nhắn Telegram.", { error: (error as Error).message });
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
  try {
    const env = getEnv();
    const gmailClient = createGmailClient(env);

    logInfo(`Bắt đầu ứng dụng. Chu kỳ kiểm tra Gmail: ${POLLING_INTERVAL_MS / 60000} phút.`);
    logInfo("Bot Telegram đã sẵn sàng trả lời câu hỏi!");
    logInfo("Bot sẽ lấy mail mới nhất trực tiếp từ Gmail khi bạn hỏi.");

    // Chạy vòng lặp vô tận
    while (true) {
      // Kiểm tra email mới
      await checkNewEmails(env, gmailClient);
      
      // Lắng nghe tin nhắn Telegram (chạy liên tục, không đợi interval)
      await handleTelegramMessages(env, gmailClient);
      
      // Đợi 2 giây trước khi check Telegram tiếp (để không spam API)
      await sleep(60000);
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
