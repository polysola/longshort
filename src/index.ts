import { promises as fs } from "fs";
import path from "path";
import { getEnv } from "./config/env";
import type { EnvConfig } from "./config/env";
import { getLatestReport, fetchReportsFromApi } from "./services/reportApiService";
import { analyzeReport } from "./services/geminiService";
import { sendTelegramMessage, sendTelegramChatMessage, getTelegramUpdates } from "./services/telegramService";
import { answerQuestion, formatBotReply } from "./services/chatbotService";
import { formatTelegramMessage } from "./utils/telegramFormatter";
import type { NormalizedReport } from "./types/mail";
import { logError, logInfo, logWarn } from "./utils/logger";
// import { autoCommitAndPushLogs } from "./utils/gitHelper"; // Đã tắt
import { AppError } from "./lib/errors";

const OUTPUT_PATH = path.join(process.cwd(), "logs", "latest-reports.json");
const API_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 phút - Check API
const TELEGRAM_CHECK_INTERVAL_MS = 2 * 1000; // 2 giây - Check Telegram (realtime)

// Biến lưu trạng thái ID report mới nhất đã xử lý
let lastProcessedReportId: string | null = null;
let lastTelegramUpdateId: number = 0; // Offset cho Telegram updates
let lastApiCheckTime: number = 0; // Timestamp lần check API cuối cùng

const processReport = async (
  env: EnvConfig,
  report: NormalizedReport,
): Promise<NormalizedReport | null> => {
  if (!report.id) {
    logWarn("Bỏ qua report vì thiếu ID.");
    return null;
  }

  try {
    const reportDate = new Date(report.rawDate);
    const now = new Date();
    const diffMinutes = Math.floor((now.getTime() - reportDate.getTime()) / (1000 * 60));

    logInfo("Bắt đầu xử lý report.", { 
      reportId: report.id,
      createdAt: report.date,
      ageMinutes: diffMinutes,
      symbolCount: report.symbols.length,
    });

    // 1. Phân tích với Gemini
    const analysis = await analyzeReport(env, report);

    // 2. Format tin nhắn Telegram với thời gian chi tiết
    const separator = `\n━━━━━━━━━━━━━━━━━━━━━━\n📊 *Report từ API:* ${report.date}\n⏰ *Xử lý lúc:* ${now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}\n📈 *Symbols:* ${report.symbols.length} coins\n━━━━━━━━━━━━━━━━━━━━━━\n`;
    
    const baseMessage = formatTelegramMessage(analysis);
    const finalMessage = separator + baseMessage;

    // 3. Gửi Telegram
    await sendTelegramMessage(env, finalMessage);

    logInfo("Đã xử lý & gửi Telegram thành công.", {
      reportId: report.id,
      signals: analysis.signals?.length ?? 0,
    });

    return report;
  } catch (error) {
    logError("Lỗi khi xử lý report.", {
      reportId: report.id,
      error: (error as Error).message,
      details: (error as AppError).context || (error as any).cause,
    });

    return null;
  }
};

const saveReportsToFile = async (reports: NormalizedReport[]) => {
  try {
    await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await fs.writeFile(
      OUTPUT_PATH,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          total: reports.length,
          reports: reports.map((r) => ({
            id: r.id,
            subject: r.subject,
            date: r.date,
            symbols: r.symbols,
            reportType: r.reportType,
          })),
        },
        null,
        2,
      ),
      "utf8",
    );

    logInfo("Đã lưu log report vào file JSON.", { file: OUTPUT_PATH });
    
  } catch (error) {
    logError("Không thể ghi file JSON.", { error: (error as Error).message });
  }
};

// Lấy report mới nhất trực tiếp từ API
const getLatestReportFromApi = async (): Promise<NormalizedReport | null> => {
  try {
    const latestReport = await getLatestReport();
    return latestReport;
  } catch (error) {
    logError("Không thể lấy report mới nhất từ API.", { error: (error as Error).message });
    return null;
  }
};

const checkNewReports = async (env: EnvConfig) => {
  logInfo("Đang kiểm tra API reports...");

  const latestReport = await getLatestReportFromApi();

  if (!latestReport) {
    logInfo("Không tìm thấy report nào từ API.");
    return;
  }

  // Log thông tin report mới nhất
  const reportDate = new Date(latestReport.rawDate);
  const diffMinutes = Math.floor((Date.now() - reportDate.getTime()) / (1000 * 60));

  logInfo("Report mới nhất tìm thấy:", {
    id: latestReport.id,
    createdAt: latestReport.date,
    ageMinutes: diffMinutes,
    symbols: latestReport.symbols.length,
  });

  // Kiểm tra trùng lặp: Nếu ID report này trùng với report đã xử lý lần trước -> Bỏ qua
  if (latestReport.id === lastProcessedReportId) {
    logInfo("Không có report mới. (ID report mới nhất trùng với ID đã xử lý)", { id: latestReport.id });
    return;
  }

  // Kiểm tra tuổi của report (chỉ xử lý report mới trong 30 phút)
  if (diffMinutes > 30) {
    logInfo(`Report mới nhất quá cũ (${diffMinutes} phút). Bỏ qua.`);
    // Vẫn cập nhật ID để không check lại
    lastProcessedReportId = latestReport.id;
    return;
  }

  // Nếu khác ID -> Có report mới -> Xử lý
  logInfo("Phát hiện report mới (hoặc chạy lần đầu).", { 
    newId: latestReport.id, 
    oldId: lastProcessedReportId 
  });

  const processed = await processReport(env, latestReport);

  if (processed) {
    // Cập nhật ID đã xử lý
    lastProcessedReportId = processed.id;
    await saveReportsToFile([processed]);
  }
};

// Xử lý tin nhắn từ Telegram (Chatbot)
const handleTelegramMessages = async (env: EnvConfig) => {
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

      // Gửi tin nhắn "đang xử lý" ngay lập tức với format đẹp (Markdown)
      const processingMsg = `🔄 *ĐANG XỬ LÝ...*

📥 Đang lấy report mới nhất từ API
🤖 Đang phân tích dữ liệu với AI
⏱️ Vui lòng đợi trong giây lát...`;
      await sendTelegramChatMessage(env, processingMsg);

      // Lấy report mới nhất trực tiếp từ API
      const latestReport = await getLatestReportFromApi();

      if (!latestReport) {
        const errorMsg = `❌ *KHÔNG TÌM THẤY DỮ LIỆU*

Không có report nào từ API.
Vui lòng thử lại sau hoặc kiểm tra nguồn dữ liệu.`;
        await sendTelegramChatMessage(env, errorMsg);
        continue;
      }

      // Trả lời dựa trên report mới nhất (AI đã format Markdown)
      const answer = await answerQuestion(env, userMessage, latestReport);

      // Format report date
      const reportDate = latestReport.date;

      // Gửi trả lời với format đẹp (Markdown)
      const formattedReply = formatBotReply(answer, reportDate);
      await sendTelegramChatMessage(env, formattedReply);

    }
  } catch (error) {
    logError("Lỗi khi xử lý tin nhắn Telegram.", { error: (error as Error).message });
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
  try {
    const env = getEnv();

    logInfo(`Bắt đầu ứng dụng.`);
    logInfo(`📊 API: Check mỗi ${API_CHECK_INTERVAL_MS / 60000} phút`);
    logInfo(`💬 Telegram: Check realtime (mỗi ${TELEGRAM_CHECK_INTERVAL_MS / 1000} giây)`);
    logInfo("Bot Telegram đã sẵn sàng trả lời câu hỏi!");
    logInfo("🔗 Data source: https://first.fsignal.xyz/api/reports");

    // Chạy vòng lặp vô tận
    while (true) {
      const now = Date.now();
      
      // Kiểm tra API chỉ khi đã qua 1 phút kể từ lần check cuối
      if (now - lastApiCheckTime >= API_CHECK_INTERVAL_MS) {
        await checkNewReports(env);
        lastApiCheckTime = now;
      }
      
      // Lắng nghe tin nhắn Telegram (chạy mỗi vòng lặp = realtime)
      await handleTelegramMessages(env);
      
      // Đợi 2 giây trước khi lặp lại (Telegram check mỗi 2s)
      await sleep(TELEGRAM_CHECK_INTERVAL_MS);
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
