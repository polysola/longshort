import { GoogleGenerativeAI } from "@google/generative-ai";
import { EnvConfig } from "../config/env";
import { NormalizedMail, NormalizedReport } from "../types/mail";
import { ExternalServiceError } from "../lib/errors";
import { logDebug, logInfo } from "../utils/logger";
import { ENTRY_SCORE_RULES, VIETNAMESE_TERMS } from "../config/scoringRules";

// ════════════════════════════════════════════
// CONVERSATION HISTORY
// ════════════════════════════════════════════
type ConversationItem = {
  question: string;
  answer: string;
  timestamp: Date;
  reportDate?: string;
};

const MAX_HISTORY = 5;
let conversationHistory: ConversationItem[] = [];

const addToHistory = (question: string, answer: string, reportDate?: string): void => {
  conversationHistory.unshift({
    question,
    answer,
    timestamp: new Date(),
    ...(reportDate && { reportDate })
  });
  
  if (conversationHistory.length > MAX_HISTORY) {
    conversationHistory = conversationHistory.slice(0, MAX_HISTORY);
  }
  
  logInfo("Đã lưu vào lịch sử hội thoại.", { 
    total: conversationHistory.length,
    question: question.substring(0, 50) + "..."
  });
};

const buildConversationHistory = () => {
  return [...conversationHistory].reverse().flatMap((item) => [
    { role: "user", parts: [{ text: item.question }] },
    { role: "model", parts: [{ text: item.answer }] }
  ]);
};

export const getConversationHistoryDebug = () => {
  return conversationHistory.map((item, index) => ({
    index: index + 1,
    question: item.question,
    answer: item.answer.substring(0, 100) + "...",
    timestamp: item.timestamp.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
    reportDate: item.reportDate
  }));
};

export const resetConversationHistory = () => {
  const oldLength = conversationHistory.length;
  conversationHistory = [];
  logInfo("Đã reset lịch sử hội thoại.", { oldLength });
};

// ════════════════════════════════════════════
// BUILD CONTEXT DATA
// ════════════════════════════════════════════
const buildContextData = (
  data: NormalizedReport | NormalizedReport[] | NormalizedMail | null
): string => {
  if (!data) {
    return "KHÔNG CÓ DỮ LIỆU BÁO CÁO.";
  }

  // Nhiều reports (cho so sánh)
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return "KHÔNG CÓ DỮ LIỆU BÁO CÁO.";
    }

    logInfo("Đang xây dựng context từ nhiều báo cáo.", { count: data.length });

    let context = `
════════════════════════════════════════════
📊 DỮ LIỆU ${data.length} BÁO CÁO - SO SÁNH KHUNG THỜI GIAN
════════════════════════════════════════════
`;

    data.forEach((report, index) => {
      context += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 BÁO CÁO ${index + 1}/${data.length}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• ID: ${report.id}
• Thời gian: ${report.date}
• Loại: ${report.reportType}
• Coins (${report.symbols.length}): ${report.symbols.join(", ")}

=== NỘI DUNG ===
${report.sectionsMarkdown.join("\n\n---\n\n")}
`;
    });

    context += `
════════════════════════════════════════════
HƯỚNG DẪN SO SÁNH:
• So sánh giá Vào lệnh, Cắt lỗ, Chốt lời giữa các báo cáo
• Xem xu hướng: MUA → BÁN hoặc ngược lại
• Chú ý thời gian để biết độ mới
════════════════════════════════════════════
`;

    return context;
  }

  // Một report
  if ('sectionsMarkdown' in data) {
    const report = data as NormalizedReport;
    return `
DỮ LIỆU BÁO CÁO MỚI NHẤT:
━━━━━━━━━━━━━━━━━━━━━━
• ID: ${report.id}
• Tiêu đề: ${report.subject}
• Nguồn: ${report.from}
• Thời gian: ${report.date}
• Loại: ${report.reportType}
• Coins (${report.symbols.length}): ${report.symbols.join(", ")}

=== NỘI DUNG CHI TIẾT ===
${report.sectionsMarkdown.join("\n\n---\n\n")}
`;
  }

  // Legacy: Email
  const mail = data as NormalizedMail;
  return `
DỮ LIỆU EMAIL:
• Tiêu đề: ${mail.subject}
• Từ: ${mail.from}
• Ngày: ${mail.date}
• Nội dung: 
${mail.htmlText || mail.plainText || mail.snippet}
`;
};

// ════════════════════════════════════════════
// GENERATE VIETNAMESE TERMS GUIDE
// ════════════════════════════════════════════
const generateTermsGuide = (): string => {
  const terms = Object.entries(VIETNAMESE_TERMS)
    .map(([en, { vi, explain }]) => `• ${en} = ${vi} (${explain})`)
    .join("\n");
  
  return `
BẢNG THUẬT NGỮ TIẾNG VIỆT:
━━━━━━━━━━━━━━━━━━━━━━
${terms}
`;
};

// ════════════════════════════════════════════
// ANSWER QUESTION
// ════════════════════════════════════════════
export const answerQuestion = async (
  config: EnvConfig,
  question: string,
  data: NormalizedReport | NormalizedReport[] | NormalizedMail | null
): Promise<string> => {
  const genAI = new GoogleGenerativeAI(config.geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: config.geminiModel,
  });

  try {
    const conversationHistoryArray = buildConversationHistory();
    const contextData = buildContextData(data);
    const isMultipleReports = Array.isArray(data);
    const termsGuide = generateTermsGuide();
    
    logInfo("Đang xử lý câu hỏi.", {
      isMultipleReports,
      reportCount: isMultipleReports ? data.length : (data ? 1 : 0),
      contextLength: contextData.length,
      hasData: !!data
    });

    const systemPrompt = `Bạn là trợ lý phân tích tín hiệu Crypto chuyên nghiệp, LUÔN trả lời bằng TIẾNG VIỆT.

═══════════════════════════════════════════════════════════
NGUYÊN TẮC BẮT BUỘC:
═══════════════════════════════════════════════════════════
1. ⚠️ TUYỆT ĐỐI KHÔNG BỊA dữ liệu không có trong báo cáo
2. ⚠️ CHỈ trả lời dựa trên DỮ LIỆU BÁO CÁO bên dưới
3. ⚠️ Nếu không có thông tin → Nói rõ: "❌ Báo cáo không có thông tin về [vấn đề]"
4. ⚠️ LUÔN dùng thuật ngữ TIẾNG VIỆT (xem bảng bên dưới)

${termsGuide}

═══════════════════════════════════════════════════════════
CÁCH TRẢ LỜI:
═══════════════════════════════════════════════════════════

A. KHI NGƯỜI DÙNG HỎI VỀ THUẬT NGỮ:
   Giải thích chi tiết, dễ hiểu, có ví dụ cụ thể.
   
   Ví dụ: "R:R là gì?"
   → "📚 *R:R (Lợi nhuận/Rủi ro)*
   
   Đây là tỷ lệ giữa số tiền có thể lời và số tiền có thể mất.
   
   _Ví dụ:_ R:R = 3.0 nghĩa là:
   • Nếu đúng: Lời 3 phần
   • Nếu sai: Mất 1 phần
   
   R:R càng cao càng tốt. Thường nên ≥ 2.0"

B. KHI NGƯỜI DÙNG HỎI VỀ COIN CỤ THỂ:
   Trích xuất CHÍNH XÁC từ báo cáo, format đẹp.
   
   Ví dụ format:
   ━━━━━━━━━━━━━━━━━━━━━━
   🔴 *BTCUSDT* - BÁN
   ━━━━━━━━━━━━━━━━━━━━━━
   
   📊 *Điểm tín hiệu:* \`85\`/100 ⭐⭐⭐
   🎯 *Điểm vào lệnh:* \`78\`/100 ⭐⭐
   
   📥 *Điểm vào:* \`91,484\` USDT
   🛑 *Cắt lỗ:* \`93,200\` USDT
   🎯 *Chốt lời:*
      • Mức 1: \`89,500\`
      • Mức 2: \`87,200\`
      • Mức 3: \`84,000\`
   
   📈 *Lợi nhuận/Rủi ro:* 2.5
   ⏱ *Khung giờ:* 4h
   
   💡 _Xu hướng giảm mạnh, ADX > 25_
   ━━━━━━━━━━━━━━━━━━━━━━

C. HỆ THỐNG CHẤM ĐIỂM (THANG 100):
${ENTRY_SCORE_RULES}

${isMultipleReports ? `
D. KHI SO SÁNH NHIỀU BÁO CÁO:
   • So sánh thay đổi giữa các mốc thời gian
   • Nêu rõ xu hướng: Tăng/Giảm/Đổi chiều
   • Dùng bảng so sánh nếu cần
   
   Ví dụ:
   ━━━━━━━━━━━━━━━━━━━━━━
   📊 *SO SÁNH BTCUSDT*
   ━━━━━━━━━━━━━━━━━━━━━━
   
   📅 *Báo cáo 1* (19:50)
      • Hướng: 🔴 BÁN
      • Vào: \`91,484\`
      • Điểm: 85/100
   
   📅 *Báo cáo 2* (18:50)
      • Hướng: 🔴 BÁN  
      • Vào: \`92,100\`
      • Điểm: 78/100
   
   📈 *XU HƯỚNG:*
      ╰─ Giữ nguyên BÁN
      ╰─ Giá vào giảm 616 USDT
      ╰─ Điểm tăng từ 78 → 85
   ━━━━━━━━━━━━━━━━━━━━━━
` : ''}

═══════════════════════════════════════════════════════════
DỮ LIỆU BÁO CÁO:
═══════════════════════════════════════════════════════════
${contextData}

═══════════════════════════════════════════════════════════
FORMAT TELEGRAM MARKDOWN:
═══════════════════════════════════════════════════════════
• *in đậm* (1 dấu sao)
• _in nghiêng_ (dấu gạch dưới)
• \`code\` (backtick) cho số liệu
• ━━━ cho đường kẻ
• Emoji: 📊💰🎯🛑📥📈📉🟢🔴⚠️✅❌🔥⭐💡

HÃY TRẢ LỜI BẰNG TIẾNG VIỆT!`;

    const contents = [
      { role: "user", parts: [{ text: systemPrompt }] },
      { role: "model", parts: [{ text: "Đã hiểu! Tôi sẽ trả lời bằng tiếng Việt, dựa trên dữ liệu báo cáo, không bịa thông tin. Hãy hỏi tôi!" }] },
      ...conversationHistoryArray,
      { role: "user", parts: [{ text: question }] }
    ];

    logInfo("Gửi request đến Gemini.", {
      historyLength: conversationHistoryArray.length,
      totalMessages: contents.length
    });

    const result = await model.generateContent({ contents });
    const answer = result.response.text() || "❌ Xin lỗi, tôi không thể trả lời câu hỏi này.";
    
    // Lưu vào history
    let dataDate: string | undefined;
    if (Array.isArray(data) && data.length > 0) {
      dataDate = `${data.length} báo cáo`;
    } else if (data && 'date' in data) {
      dataDate = data.date;
    }
    addToHistory(question, answer, dataDate);
    
    return answer;

  } catch (error) {
    logDebug("Lỗi khi trả lời với Gemini.", { error: (error as Error).message });
    throw new ExternalServiceError("Không thể trả lời câu hỏi.", {
      cause: (error as Error).message,
    });
  }
};

// ════════════════════════════════════════════
// FORMAT BOT REPLY
// ════════════════════════════════════════════
export const formatBotReply = (answer: string, reportDate?: string): string => {
  const timestamp = new Date().toLocaleString('vi-VN', { 
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit'
  });

  const header = `┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  🤖 *TRỢ LÝ CRYPTO*          ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

`;

  let footer = `

╭───────────────────────────╮
│ ⏰ *Trả lời:* ${timestamp}`;
  if (reportDate) {
    footer += `
│ 📊 *Dữ liệu:* ${reportDate}`;
  }
  footer += `
│ 💡 *Lưu ý:* Tự nghiên cứu trước khi giao dịch
╰───────────────────────────╯`;

  return header + answer + footer;
};
