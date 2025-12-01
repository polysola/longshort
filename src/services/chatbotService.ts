import { GoogleGenerativeAI } from "@google/generative-ai";
import { EnvConfig } from "../config/env";
import { NormalizedMail, NormalizedReport } from "../types/mail";
import { ExternalServiceError } from "../lib/errors";
import { logDebug, logInfo } from "../utils/logger";
import { ENTRY_SCORE_RULES, TRADING_TERMS } from "../config/scoringRules";

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
// GENERATE TERMS GUIDE
// ════════════════════════════════════════════
const generateTermsGuide = (): string => {
  const terms = Object.entries(TRADING_TERMS)
    .map(([term, explain]) => `• <b>${term}</b>: ${explain}`)
    .join("\n");
  
  return `
BẢNG THUẬT NGỮ TRADING:
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

    const systemPrompt = `Bạn là trợ lý phân tích tín hiệu Crypto chuyên nghiệp.

NGUYÊN TẮC:
1. KHÔNG BỊA dữ liệu không có trong báo cáo
2. CHỈ trả lời dựa trên DỮ LIỆU BÁO CÁO bên dưới
3. Nếu không có thông tin → "❌ Báo cáo không có thông tin về [vấn đề]"
4. GIỮ NGUYÊN thuật ngữ: LONG, SHORT, Entry, SL, TP, R:R

${termsGuide}

CÁCH TRẢ LỜI:

A. KHI HỎI VỀ THUẬT NGỮ:
   Giải thích chi tiết, có ví dụ.
   
   Ví dụ: "R:R là gì?"
   
   📚 R:R (Risk:Reward)
   
   Tỷ lệ giữa tiền có thể lời và tiền có thể mất.
   
   Ví dụ: R:R = 3.0 nghĩa là:
   • Đúng → Lời 3 phần
   • Sai → Mất 1 phần
   
   R:R ≥ 2.0 là tốt.

B. KHI HỎI VỀ COIN - FORMAT CHUYÊN NGHIỆP:

┌─────────────────────────────┐
│ 🔴 BTCUSDT  ▼ SHORT  ⏱ 4h
└─────────────────────────────┘

📊 EdgeScore   \`████████░░\` 85/100
               ⚡ RẤT TỐT

🎯 EntryScore  \`███████░░░\` 72/100
               ✨ TỐT

💰 Price       \`91,262\`
📥 Entry       \`91,484\`
🛑 SL          \`93,200\`
🎯 TP          \`89,500\` → \`87,200\` → \`84,000\`
📈 R:R         \`1.3/2.5/4.0\`

💡 Good setup, clear breakout

C. 2 LOẠI ĐIỂM (THANG 100):

📊 EdgeScore: Điểm tín hiệu kỹ thuật
   Edge 7 → 100 (Cực hiếm)
   Edge 6 → 88
   Edge 5 → 73
   Edge 4 → 58
   Edge 3 → 43

🎯 EntryScore: Điểm vào lệnh tổng hợp
   = EdgeScore + R:R + Trend + Market

THANG ĐÁNH GIÁ:
• 90-100: 🔥 XUẤT SẮC
• 80-89:  ⚡ RẤT TỐT
• 70-79:  ✨ TỐT
• 55-69:  👍 KHÁ
• 40-54:  📊 TB
• 0-39:   ⬇️ YẾU

${isMultipleReports ? `
D. SO SÁNH NHIỀU BÁO CÁO:

📊 SO SÁNH BTCUSDT
═══════════════════════════════

📅 19:50 │ 🔴 SHORT
   Entry \`91,484\`
   Edge \`85\` │ Entry \`72\`

📅 18:50 │ 🔴 SHORT
   Entry \`92,100\`
   Edge \`78\` │ Entry \`65\`

📈 TREND: Giữ SHORT, Entry ↓616, Score ↑7
` : ''}

DỮ LIỆU BÁO CÁO:
${contextData}

FORMAT TELEGRAM MARKDOWN:
• KHÔNG dùng dấu * để in đậm (gây lỗi)
• Dùng \`code\` cho TẤT CẢ số liệu (giá, điểm, R:R)
• Dùng emoji thay vì dấu *
• Box: ┌─────┐ └─────┘
• Emoji: 📊💰🎯🛑📥📈📉🟢🔴⚡✨👍⬇️🔥

QUAN TRỌNG: Dùng \`backtick\` cho mọi con số!`;

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
