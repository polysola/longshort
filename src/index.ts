import { promises as fs } from "fs";
import path from "path";
import { getEnv } from "./config/env";
import type { EnvConfig } from "./config/env";
import { getLatestReport, getAllReportsForComparison, needsTimeframeComparison } from "./services/reportApiService";
import { analyzeReport } from "./services/geminiService";
import { sendTelegramMessage, sendTelegramChatMessage, getTelegramUpdates } from "./services/telegramService";
import { answerQuestion, formatBotReply } from "./services/chatbotService";
import { formatTelegramMessage } from "./utils/telegramFormatter";
import type { NormalizedReport } from "./types/mail";
import { logError, logInfo, logWarn, logDebug } from "./utils/logger";
import { AppError } from "./lib/errors";

const OUTPUT_PATH = path.join(process.cwd(), "logs", "latest-reports.json");
const API_CHECK_INTERVAL_MS = 30 * 1000; // 30 giây - Check API
const TELEGRAM_CHECK_INTERVAL_MS = 2 * 1000; // 2 giây - Check Telegram (realtime)

// ═══════════════════════════════════════════════════════════
// MEMORY - Lưu ID report đã xử lý
// ═══════════════════════════════════════════════════════════
let lastProcessedReportId: string | null = null;
let lastTelegramUpdateId: number = 0; // Offset cho Telegram updates
let lastApiCheckTime: number = 0; // Timestamp lần check API cuối cùng

// Cache report mới nhất cho chat (tránh gọi API liên tục)
let cachedLatestReport: NormalizedReport | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 60 * 1000; // Cache 1 phút

// ═══════════════════════════════════════════════════════════
// PROCESS REPORT - Xử lý và gửi Telegram khi có report mới
// ═══════════════════════════════════════════════════════════
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
          lastProcessedId: lastProcessedReportId,
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

    logDebug("Đã lưu log report vào file JSON.", { file: OUTPUT_PATH });
    
  } catch (error) {
    logError("Không thể ghi file JSON.", { error: (error as Error).message });
  }
};

// ═══════════════════════════════════════════════════════════
// GET REPORT - Lấy report với caching
// ═══════════════════════════════════════════════════════════
const getLatestReportWithCache = async (): Promise<NormalizedReport | null> => {
  const now = Date.now();
  
  // Nếu cache còn hạn, dùng cache
  if (cachedLatestReport && (now - cacheTimestamp) < CACHE_TTL_MS) {
    logDebug("Sử dụng cached report.", { reportId: cachedLatestReport.id });
    return cachedLatestReport;
  }
  
  // Nếu không, fetch mới
  try {
    const latestReport = await getLatestReport();
    if (latestReport) {
      cachedLatestReport = latestReport;
      cacheTimestamp = now;
    }
    return latestReport;
  } catch (error) {
    logError("Không thể lấy report mới nhất từ API.", { error: (error as Error).message });
    return cachedLatestReport; // Trả về cache cũ nếu có
  }
};

// ═══════════════════════════════════════════════════════════
// CHECK NEW REPORTS - Polling API và gửi Telegram khi có ID mới
// ═══════════════════════════════════════════════════════════
const checkNewReports = async (env: EnvConfig) => {
  logDebug("Đang kiểm tra API reports...");

  const latestReport = await getLatestReportWithCache();

  if (!latestReport) {
    logDebug("Không tìm thấy report nào từ API.");
    return;
  }

  // Log thông tin report mới nhất
  const reportDate = new Date(latestReport.rawDate);
  const diffMinutes = Math.floor((Date.now() - reportDate.getTime()) / (1000 * 60));

  // Kiểm tra trùng lặp: Nếu ID report này trùng với report đã xử lý lần trước -> Bỏ qua
  if (latestReport.id === lastProcessedReportId) {
    logDebug("Không có report mới.", { id: latestReport.id, ageMinutes: diffMinutes });
    return;
  }

  // Nếu là lần chạy đầu tiên (lastProcessedReportId = null)
  if (lastProcessedReportId === null) {
    logInfo("Lần chạy đầu tiên, lưu ID report mới nhất vào memory.", { 
      id: latestReport.id,
      createdAt: latestReport.date
    });
    
    // Kiểm tra tuổi của report
    if (diffMinutes <= 5) {
      // Report mới (trong 5 phút) -> Xử lý và gửi
      logInfo("Report mới trong 5 phút, xử lý và gửi Telegram.");
      const processed = await processReport(env, latestReport);
      if (processed) {
        lastProcessedReportId = processed.id;
        await saveReportsToFile([processed]);
      }
    } else {
      // Report cũ -> Chỉ lưu ID, không gửi
      logInfo(`Report đã cũ (${diffMinutes} phút), chỉ lưu ID.`);
      lastProcessedReportId = latestReport.id;
    }
    return;
  }

  // Nếu khác ID -> Có report MỚI -> Xử lý và gửi Telegram
  logInfo("🆕 PHÁT HIỆN REPORT MỚI!", { 
    newId: latestReport.id, 
    oldId: lastProcessedReportId,
    createdAt: latestReport.date,
    ageMinutes: diffMinutes
  });

  const processed = await processReport(env, latestReport);

  if (processed) {
    // Cập nhật ID đã xử lý vào memory
    lastProcessedReportId = processed.id;
    await saveReportsToFile([processed]);
    logInfo("✅ Đã cập nhật ID mới vào memory.", { id: lastProcessedReportId });
  }
};

// ═══════════════════════════════════════════════════════════
// HANDLE TELEGRAM MESSAGES - Chatbot với hỗ trợ timeframe comparison
// ═══════════════════════════════════════════════════════════
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

      try {
        // Gửi tin nhắn "đang xử lý" ngay lập tức
        const processingMsg = `🔄 *ĐANG XỬ LÝ...*

📥 Đang lấy dữ liệu từ API
🤖 Đang phân tích với AI
⏱️ Vui lòng đợi trong giây lát...`;
        await sendTelegramChatMessage(env, processingMsg);
      } catch (sendError) {
        logWarn("Không gửi được tin nhắn 'đang xử lý'. Tiếp tục...", { 
          error: (sendError as Error).message 
        });
      }

      // Kiểm tra xem user có hỏi về timeframe comparison không
      const needsComparison = needsTimeframeComparison(userMessage);
      
      let dataForAI: NormalizedReport | NormalizedReport[] | null = null;
      let reportDate = "";

      if (needsComparison) {
        // User hỏi về so sánh, lịch sử -> Lấy nhiều reports
        logInfo("🔄 User hỏi về timeframe comparison, đang lấy nhiều reports...");
        const reports = await getAllReportsForComparison();
        
        logInfo("Đã lấy reports cho comparison.", { 
          count: reports.length,
          reportIds: reports.map(r => r.id)
        });
        
        if (reports.length > 0) {
          dataForAI = reports; // Truyền TOÀN BỘ reports cho AI
          reportDate = `${reports.length} reports (${reports[0]?.date} → ${reports[reports.length - 1]?.date})`;
        }
      } else {
        // Câu hỏi bình thường -> Lấy report mới nhất (theo ID)
        dataForAI = await getLatestReportWithCache();
        reportDate = (dataForAI as NormalizedReport)?.date || "";
      }

      if (!dataForAI || (Array.isArray(dataForAI) && dataForAI.length === 0)) {
        try {
          const errorMsg = `❌ *KHÔNG TÌM THẤY DỮ LIỆU*

Không có report nào từ API.
Vui lòng thử lại sau hoặc kiểm tra nguồn dữ liệu.`;
          await sendTelegramChatMessage(env, errorMsg);
        } catch (sendError) {
          logError("Không gửi được tin nhắn lỗi.", { error: (sendError as Error).message });
        }
        continue;
      }

      try {
        // Trả lời dựa trên data - TRUYỀN TOÀN BỘ (1 hoặc nhiều reports)
        const answer = await answerQuestion(env, userMessage, dataForAI);

        // Gửi trả lời với format đẹp (Markdown)
        const formattedReply = formatBotReply(answer, reportDate);
        await sendTelegramChatMessage(env, formattedReply);
        
      } catch (answerError) {
        logError("Lỗi khi trả lời câu hỏi.", { 
          error: (answerError as Error).message,
          question: userMessage
        });
        
        // Gửi thông báo lỗi cho user
        try {
          const errorMsg = `❌ *LỖI XỬ LÝ*

Không thể xử lý câu hỏi của bạn.
Lỗi: ${(answerError as Error).message}

Vui lòng thử lại sau.`;
          await sendTelegramChatMessage(env, errorMsg);
        } catch (sendError) {
          logError("Không gửi được tin nhắn lỗi cho user.", { 
            error: (sendError as Error).message 
          });
        }
      }
    }
  } catch (error) {
    // Log chi tiết hơn
    const appError = error as AppError;
    logError("Lỗi khi xử lý tin nhắn Telegram.", { 
      error: appError.message,
      context: appError.context,
      stack: appError.stack?.substring(0, 500)
    });
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ═══════════════════════════════════════════════════════════
// MAIN - Entry point
// ═══════════════════════════════════════════════════════════
const main = async () => {
  try {
    const env = getEnv();

    logInfo(`🚀 Bắt đầu ứng dụng.`);
    logInfo(`📊 API Polling: Mỗi ${API_CHECK_INTERVAL_MS / 1000} giây`);
    logInfo(`💬 Telegram: Check realtime (mỗi ${TELEGRAM_CHECK_INTERVAL_MS / 1000} giây)`);
    logInfo("🤖 Bot Telegram đã sẵn sàng trả lời câu hỏi!");
    logInfo("🔗 Data source: https://first.fsignal.xyz/api/reports");
    logInfo("📝 Memory: Lưu ID report, chỉ gửi khi có ID mới");

    // Chạy vòng lặp vô tận
    while (true) {
      const now = Date.now();
      
      // Kiểm tra API mỗi 30 giây
      if (now - lastApiCheckTime >= API_CHECK_INTERVAL_MS) {
        await checkNewReports(env);
        lastApiCheckTime = now;
      }
      
      // Lắng nghe tin nhắn Telegram (chạy mỗi vòng lặp = realtime)
      await handleTelegramMessages(env);
      
      // Đợi 2 giây trước khi lặp lại
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
