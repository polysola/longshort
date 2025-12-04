import { GoogleGenerativeAI } from "@google/generative-ai";
import { EnvConfig } from "../config/env";
import { NormalizedMail, NormalizedReport } from "../types/mail";
import { ExternalServiceError } from "../lib/errors";
import { logDebug, logInfo } from "../utils/logger";
import { UNIFIED_SCORING_PROMPT, TRADING_TERMS, getScoreLevel, formatScoreWithLevel } from "../config/scoringRules";

// ════════════════════════════════════════════════════════════════════════════════
// CONVERSATION HISTORY
// ════════════════════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════════════════════
// BUILD CONTEXT DATA
// ════════════════════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════════════════════
// GENERATE TERMS GUIDE
// ════════════════════════════════════════════════════════════════════════════════

const generateTermsGuide = (): string => {
  const terms = Object.entries(TRADING_TERMS)
    .map(([term, explain]) => `• <b>${term}</b>: ${explain}`)
    .join("\n");
  
  return `
BẢNG THUẬT NGỮ TRADING:
${terms}
`;
};

// ════════════════════════════════════════════════════════════════════════════════
// ANSWER QUESTION
// ════════════════════════════════════════════════════════════════════════════════

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

${UNIFIED_SCORING_PROMPT}

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

B. KHI HỎI VỀ COIN - FORMAT RÕ RÀNG VÀ ĐẦY ĐỦ và chuyên sâu,chuyên nghiệp:

🔴🔴🔴 BTCUSDT ▼ SHORT
    ⏱ 4h  │  📍 BREAKOUT  │  📋 Scenario B

    📊 Edge: \`88\` ⚡ RẤT TỐT
    🎯 Entry Score: \`72\` ✨ TỐT

    💰 Giá hiện tại: \`91,262\`
    📥 Trigger: \`91,484\`
    🛑 Stop Loss: \`93,200\`
    🎯 TP1: \`89,500\`
    🎯 TP2: \`87,200\`
    🎯 TP3: \`84,000\`
    📈 R:R: \`1.3/2.5/4.0\`

    📍 Phá vỡ mức kháng cự/hỗ trợ
    📋 Breakout rõ ràng - Phá vỡ với volume
    💡 ADX > 25, xu hướng mạnh, momentum tăng

C. 2 LOẠI ĐIỂM (THANG 100) - LUÔN HIỂN THỊ MỨC ĐỘ:

📊 EdgeScore: Điểm tín hiệu kỹ thuật thuần túy
   • Chuyển từ thang 7 → 100 (Edge 6 = 88, Edge 5 = 73, Edge 4 = 58...)
   
🎯 EntryScore: Điểm vào lệnh tổng hợp (Edge + R:R + Trend + Market)
   • Đây là điểm QUAN TRỌNG NHẤT để quyết định vào lệnh

THANG MỨC ĐỘ (ÁP DỤNG CHO CẢ 2 LOẠI ĐIỂM):
🔥 90-100: CỰC TỐT (EXCELLENT) - Cơ hội vàng
⚡ 80-89: RẤT TỐT (VERY GOOD) - Nên vào lệnh
✨ 70-79: TỐT (GOOD) - Cân nhắc vào lệnh
👍 55-69: KHÁ (FAIR) - Cẩn thận
📊 40-54: TRUNG BÌNH (WEAK) - Rủi ro cao
⬇️ 0-39: YẾU (POOR) - Không nên vào lệnh

QUAN TRỌNG: Luôn hiển thị điểm KÈM mức độ!
VD: "📊 Edge \`88\` ⚡ RẤT TỐT" thay vì chỉ "Edge 88"

D. LOẠI VÀO LỆNH:
📍 BREAKOUT: Vào khi giá phá vỡ mức quan trọng
📍 LIMIT: Đặt lệnh chờ khi giá hồi về
📍 MARKET: Vào lệnh ngay tại giá hiện tại

E. SCENARIO:
📋 A: Setup hoàn hảo - tất cả điều kiện thuận lợi
📋 B: Breakout rõ ràng với volume
📋 C: Compression - giá nén, chuẩn bị bùng nổ
📋 D: Cần thêm xác nhận
📋 F1/F2/F3: Pullback về hỗ trợ/MA/Fibo
📋 G: Rủi ro cao

${isMultipleReports ? `
F. SO SÁNH NHIỀU BÁO CÁO:

📊 SO SÁNH BTCUSDT
═══════════════════════════════

📅 19:50 │ 🔴 SHORT
   Entry \`91,484\`
   Edge \`88\` ⚡ │ Entry \`72\` ✨

📅 18:50 │ 🔴 SHORT
   Entry \`92,100\`
   Edge \`73\` ✨ │ Entry \`65\` 👍

📈 TREND: Giữ SHORT, Entry ↓616, Score ↑7
` : ''}

DỮ LIỆU BÁO CÁO:
${contextData}

FORMAT TELEGRAM MARKDOWN:
• KHÔNG dùng dấu * để in đậm (gây lỗi)
• Dùng \`code\` cho TẤT CẢ số liệu (giá, điểm, R:R)
• Dùng emoji thay vì dấu *
• Box gọn: ┌───┐ └───┘ (ít dấu - hơn)
• Emoji: 📊💰🎯🛑📥📈📉🟢🔴⚡✨👍⬇️🔥

QUAN TRỌNG: 
• Dùng \`backtick\` cho mọi con số!
• LUÔN hiển thị mức độ bên cạnh điểm số!`;

    const contents = [
      { role: "user", parts: [{ text: systemPrompt }] },
      { role: "model", parts: [{ text: "Đã hiểu! Tôi sẽ trả lời bằng tiếng Việt, dựa trên dữ liệu báo cáo, hiển thị điểm KÈM mức độ. Hãy hỏi tôi!" }] },
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

// ════════════════════════════════════════════════════════════════════════════════
// FORMAT BOT REPLY
// ════════════════════════════════════════════════════════════════════════════════

export const formatBotReply = (answer: string, reportDate?: string): string => {
  const timestamp = new Date().toLocaleString('vi-VN', { 
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit'
  });

  const header = `┏━━━━━━━━━━━━━━━━━━━━━━┓
┃  🤖 TRỢ LÝ CRYPTO     ┃
┗━━━━━━━━━━━━━━━━━━━━━━┛

`;

  let footer = `

╭──────────────────╮
│ ⏰ ${timestamp}`;
  if (reportDate) {
    footer += `
│ 📊 ${reportDate}`;
  }
  footer += `
│ 💡 DYOR - Tự nghiên cứu
╰──────────────────╯`;

  return header + answer + footer;
};
