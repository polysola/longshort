import { GoogleGenerativeAI } from "@google/generative-ai";
import { EnvConfig } from "../config/env";
import { NormalizedMail, NormalizedReport } from "../types/mail";
import { ExternalServiceError } from "../lib/errors";
import { logDebug, logInfo } from "../utils/logger";
import { ENTRY_SCORE_RULES } from "../config/scoringRules";

// ═══════════════════════════════════════════════════════════
// CONVERSATION HISTORY - Lưu 5 câu hỏi/trả lời gần nhất
// ═══════════════════════════════════════════════════════════
type ConversationItem = {
  question: string;
  answer: string;
  timestamp: Date;
  reportDate?: string;
};

const MAX_HISTORY = 5;
let conversationHistory: ConversationItem[] = [];

// Thêm câu hỏi/trả lời vào lịch sử
const addToHistory = (question: string, answer: string, reportDate?: string): void => {
  const item: ConversationItem = {
    question,
    answer,
    timestamp: new Date(),
  };
  
  if (reportDate) {
    item.reportDate = reportDate;
  }
  
  conversationHistory.unshift(item);
  
  if (conversationHistory.length > MAX_HISTORY) {
    conversationHistory = conversationHistory.slice(0, MAX_HISTORY);
  }
  
  logInfo("Đã lưu câu hỏi/trả lời vào lịch sử.", { 
    totalHistory: conversationHistory.length,
    question: question.substring(0, 50) + "..."
  });
};

// Chuyển đổi lịch sử thành conversation history cho Gemini
const buildConversationHistory = () => {
  const history: Array<{ role: string; parts: Array<{ text: string }> }> = [];
  const sortedHistory = [...conversationHistory].reverse();
  
  sortedHistory.forEach((item) => {
    history.push({
      role: "user",
      parts: [{ text: item.question }]
    });
    history.push({
      role: "model",
      parts: [{ text: item.answer }]
    });
  });
  
  return history;
};

// Export helper để debug conversation history
export const getConversationHistoryDebug = () => {
  return conversationHistory.map((item, index) => ({
    index: index + 1,
    question: item.question,
    answer: item.answer.substring(0, 100) + "...",
    timestamp: item.timestamp.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
    reportDate: item.reportDate
  }));
};

// Reset conversation history
export const resetConversationHistory = () => {
  const oldLength = conversationHistory.length;
  conversationHistory = [];
  logInfo("Đã reset conversation history.", { oldLength });
};

// ═══════════════════════════════════════════════════════════
// BUILD CONTEXT DATA - Tạo context từ 1 hoặc nhiều reports
// ═══════════════════════════════════════════════════════════
const buildContextData = (
  data: NormalizedReport | NormalizedReport[] | NormalizedMail | null
): string => {
  if (!data) {
    return "KHÔNG CÓ DỮ LIỆU NÀO.";
  }

  // Nếu là array (nhiều reports cho comparison)
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return "KHÔNG CÓ DỮ LIỆU NÀO.";
    }

    logInfo("Building context từ nhiều reports.", { count: data.length });

    let context = `
═══════════════════════════════════════════════════════════
📊 DỮ LIỆU NHIỀU REPORTS (${data.length} reports) - CHO SO SÁNH TIMEFRAME
═══════════════════════════════════════════════════════════

`;

    data.forEach((report, index) => {
      context += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 REPORT ${index + 1}/${data.length}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• *Report ID:* \`${report.id}\`
• *Ngày:* ${report.date}
• *Loại:* ${report.reportType}
• *Symbols (${report.symbols.length}):* ${report.symbols.join(", ")}

=== NỘI DUNG MARKDOWN ===
${report.sectionsMarkdown.join("\n\n---\n\n")}

`;
    });

    context += `
═══════════════════════════════════════════════════════════
LƯU Ý KHI SO SÁNH:
• So sánh giá Entry, SL, TP giữa các reports
• Xem xu hướng thay đổi của tín hiệu (LONG → SHORT hoặc ngược lại)
• Chú ý thời gian của từng report để biết độ mới
═══════════════════════════════════════════════════════════
`;

    return context;
  }

  // Nếu là NormalizedReport (1 report)
  if ('sectionsMarkdown' in data) {
    const report = data as NormalizedReport;
    return `
DỮ LIỆU REPORT MỚI NHẤT TỪ API:
━━━━━━━━━━━━━━━━━━━━━━
• *Report ID:* \`${report.id}\`
• *Tiêu đề:* ${report.subject}
• *Từ:* ${report.from}
• *Ngày:* ${report.date}
• *Loại report:* ${report.reportType}
• *Symbols (${report.symbols.length}):* ${report.symbols.join(", ")}

=== NỘI DUNG CHI TIẾT (MARKDOWN) ===
${report.sectionsMarkdown.join("\n\n---\n\n")}
`;
  }

  // Legacy: NormalizedMail
  const mail = data as NormalizedMail;
  return `
DỮ LIỆU EMAIL MỚI NHẤT:
• *Tiêu đề:* ${mail.subject}
• *Từ:* ${mail.from}
• *Ngày:* ${mail.date}
• *Nội dung chính:* 
${mail.htmlText || mail.plainText || mail.snippet}
`;
};

// ═══════════════════════════════════════════════════════════
// ANSWER QUESTION - Hỗ trợ 1 hoặc nhiều reports
// ═══════════════════════════════════════════════════════════
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
    
    // Log để debug
    const isMultipleReports = Array.isArray(data);
    logInfo("Đang xử lý câu hỏi.", {
      isMultipleReports,
      reportCount: isMultipleReports ? data.length : 1,
      contextLength: contextData.length
    });

    const systemPrompt = `Bạn là trợ lý phân tích tín hiệu Crypto chuyên nghiệp, có khả năng giải thích thuật ngữ một cách dễ hiểu.

NGUYÊN TẮC QUAN TRỌNG NHẤT:
━━━━━━━━━━━━━━━━━━━━━━
1. ⚠️ TUYỆT ĐỐI KHÔNG BỊA/ĐOÁN/GIẢ ĐỊNH dữ liệu không có trong report
2. ⚠️ CHỈ TRẢ LỜI DỰA TRÊN DỮ LIỆU REPORT CÓ SẴN bên dưới
3. ⚠️ Nếu report KHÔNG chứa thông tin cần thiết → Nói rõ: "❌ Report không có thông tin về [vấn đề X]"
4. ⚠️ KHÔNG sử dụng kiến thức chung về crypto để thêm thông tin không có trong report

${isMultipleReports ? `
CHỨC NĂNG SO SÁNH TIMEFRAME:
━━━━━━━━━━━━━━━━━━━━━━
• Bạn đang nhận được ${(data as NormalizedReport[]).length} reports để SO SÁNH
• Hãy phân tích sự THAY ĐỔI giữa các mốc thời gian
• So sánh: Entry, SL, TP, Direction (LONG/SHORT), Edge Score
• Nêu rõ xu hướng: Tăng/Giảm, Đổi chiều, Giữ nguyên
• Format bảng so sánh nếu cần
` : ''}

NGUYÊN TẮC VỀ NGỮ CẢNH HỘI THOẠI:
━━━━━━━━━━━━━━━━━━━━━━
• Bạn đang trong một cuộc hội thoại liên tục với người dùng
• Nếu câu hỏi liên quan đến câu trả lời trước → Hiểu ngữ cảnh
• LUÔN ưu tiên dữ liệu report mới nhất

CÁC NHIỆM VỤ:
━━━━━━━━━━━━━━━━━━━━━━
A. TRÍCH XUẤT DỮ LIỆU:
   • Đọc kỹ report và trích xuất CHÍNH XÁC thông tin được hỏi
   • Trích dẫn GIÁ TRỊ CỤ THỂ từ report (số, giá, phần trăm)
   • KHÔNG làm tròn, thay đổi hoặc ước lượng số liệu

B. GIẢI THÍCH THUẬT NGỮ:
   • Khi trả lời có thuật ngữ chuyên ngành → LUÔN giải thích
   • Format: *Thuật ngữ* (Giải thích ngắn gọn)

C. FORMAT TRẢ LỜI (TELEGRAM MARKDOWN):
   • Dùng separator ━━━━━━━━━━
   • Icon: 📊💰🎯🛑⚡📈📉🟢🔴⚠️✅❌🔥⭐💡📥
   • *Bold* cho keywords (1 dấu sao)
   • _italic_ cho ghi chú
   • \`code\` cho số liệu

${contextData}

QUY TRÌNH TRẢ LỜI:
━━━━━━━━━━━━━━━━━━━━━━
Bước 1: Kiểm tra report có chứa thông tin được hỏi không?
Bước 2: Trích xuất CHÍNH XÁC dữ liệu từ report
Bước 3: Tính điểm gợi ý vào lệnh (0-100):
${ENTRY_SCORE_RULES}
Bước 4: Format câu trả lời đẹp
Bước 5: Kiểm tra không bịa thông tin

${isMultipleReports ? `
VÍ DỤ SO SÁNH TIMEFRAME:
━━━━━━━━━━━━━━━━━━━━━━
Câu hỏi: "So sánh BTC các mốc thời gian"

✅ TRẢ LỜI TỐT:

━━━━━━━━━━━━━━━━━━━━━━
📊 *SO SÁNH BTCUSDT QUA CÁC MỐC*
━━━━━━━━━━━━━━━━━━━━━━

📅 *Report 1* (19:50 30/11)
   • Direction: 🔴 SHORT
   • Entry: \`91,484\`
   • Edge Score: 5/7

📅 *Report 2* (18:50 30/11)  
   • Direction: 🔴 SHORT
   • Entry: \`92,100\`
   • Edge Score: 4/7

📈 *XU HƯỚNG:*
   ╰─ Giữ nguyên SHORT
   ╰─ Entry giảm 616 USDT (-0.67%)
   ╰─ Edge Score tăng từ 4 → 5

━━━━━━━━━━━━━━━━━━━━━━
` : `
VÍ DỤ TRẢ LỜI:
━━━━━━━━━━━━━━━━━━━━━━
━━━━━━━━━━━━━━━━━━━━━━
🔴 *BTCUSDT* - TÍN HIỆU SHORT
━━━━━━━━━━━━━━━━━━━━━━

📥 *Entry* (Điểm vào lệnh)
   \`83,224.63 USDT\`

🛑 *Stop Loss* (Cắt lỗ)
   \`84,573.09 USDT\`

🎯 *Take Profit* (Chốt lời)
   • TP1: \`81,471.63\`
   • TP2: \`79,853.47\`
   • TP3: \`77,830.78\`

📊 *Entry Score: 85/100* 🔥🔥 _RẤT TỐT_

━━━━━━━━━━━━━━━━━━━━━━
`}

HÃY BẮT ĐẦU TRẢ LỜI!`;

    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [
      { role: "user", parts: [{ text: systemPrompt }] },
      { role: "model", parts: [{ text: "Đã hiểu! Tôi sẽ trả lời DỰA TRÊN DỮ LIỆU REPORT, KHÔNG BỊA, format Markdown đẹp. Hãy hỏi tôi!" }] },
      ...conversationHistoryArray,
      { role: "user", parts: [{ text: question }] }
    ];

    logInfo("Đang gửi request đến Gemini.", {
      historyLength: conversationHistoryArray.length,
      totalMessages: contents.length,
      isComparison: isMultipleReports
    });

    const result = await model.generateContent({
      contents: contents,
    });

    const answer = result.response.text() || "❌ Xin lỗi, tôi không thể trả lời câu hỏi này.";
    
    // Lưu vào history
    let dataDate: string | undefined;
    if (Array.isArray(data) && data.length > 0) {
      dataDate = `${data.length} reports`;
    } else if (data && 'date' in data) {
      dataDate = data.date;
    }
    addToHistory(question, answer, dataDate);
    
    return answer;

  } catch (error) {
    logDebug("Lỗi khi trả lời câu hỏi với Gemini.", { error: (error as Error).message });
    throw new ExternalServiceError("Gemini không thể trả lời câu hỏi.", {
      cause: (error as Error).message,
    });
  }
};

// Format tin nhắn trả lời chuyên nghiệp (Telegram Markdown)
export const formatBotReply = (answer: string, reportDate?: string): string => {
  const timestamp = new Date().toLocaleString('vi-VN', { 
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit'
  });

  const header = `┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  🤖 *AI CRYPTO ADVISOR*     ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

`;

  let footer = `

╭───────────────────────────╮
│ ⏰ *Trả lời:* ${timestamp}`;
  if (reportDate) {
    footer += `
│ 📊 *Data:* ${reportDate}`;
  }
  footer += `
│ 💡 *Tip:* Luôn DYOR và quản lý rủi ro
╰───────────────────────────╯`;

  return header + answer + footer;
};
