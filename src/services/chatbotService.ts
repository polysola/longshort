import { GoogleGenerativeAI } from "@google/generative-ai";
import { EnvConfig } from "../config/env";
import { NormalizedMail, NormalizedReport } from "../types/mail";
import { ExternalServiceError } from "../lib/errors";
import { logDebug, logInfo } from "../utils/logger";
import { UNIFIED_SCORING_PROMPT, TRADING_TERMS } from "../config/scoringRules";

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
  if (!data) return "KHÔNG CÓ DỮ LIỆU BÁO CÁO.";

  if (Array.isArray(data)) {
    if (data.length === 0) return "KHÔNG CÓ DỮ LIỆU BÁO CÁO.";

    logInfo("Đang xây dựng context từ nhiều báo cáo.", { count: data.length });

    let context = `\n📊 DỮ LIỆU ${data.length} BÁO CÁO\n`;

    data.forEach((report, index) => {
      context += `
━━━ BÁO CÁO ${index + 1}/${data.length} ━━━
• ID: ${report.id}
• Thời gian: ${report.date}
• Coins (${report.symbols.length}): ${report.symbols.join(", ")}

${report.sectionsMarkdown.join("\n\n")}
`;
    });

    return context;
  }

  if ('sectionsMarkdown' in data) {
    const report = data as NormalizedReport;
    return `
━━━ BÁO CÁO MỚI NHẤT ━━━
• ID: ${report.id}
• Thời gian: ${report.date}
• Coins (${report.symbols.length}): ${report.symbols.join(", ")}

${report.sectionsMarkdown.join("\n\n")}
`;
  }

  const mail = data as NormalizedMail;
  return `
━━━ EMAIL ━━━
• Tiêu đề: ${mail.subject}
• Từ: ${mail.from}
• Ngày: ${mail.date}
${mail.htmlText || mail.plainText || mail.snippet}
`;
};

// ════════════════════════════════════════════════════════════════════════════════
// GENERATE TERMS GUIDE
// ════════════════════════════════════════════════════════════════════════════════

const generateTermsGuide = (): string => {
  const terms = Object.entries(TRADING_TERMS)
    .map(([term, explain]) => `• ${term}: ${explain}`)
    .join("\n");
  
  return `THUẬT NGỮ:\n${terms}`;
};

// ════════════════════════════════════════════════════════════════════════════════
// PROFESSIONAL ANALYST PROMPT
// ════════════════════════════════════════════════════════════════════════════════

const buildProfessionalPrompt = (
  contextData: string,
  termsGuide: string,
  isMultipleReports: boolean
): string => {
  return `BẠN LÀ NHÀ PHÂN TÍCH THỊ TRƯỜNG CRYPTO CHUYÊN NGHIỆP

🎯 VAI TRÒ:
- Nhà phân tích kỹ thuật với 10+ năm kinh nghiệm
- Chuyên gia về Price Action, Volume, Indicators (RSI, MACD, Bollinger, Ichimoku)
- Quản lý rủi ro và Position Sizing chuyên sâu
- Phân tích Multi-Timeframe (MTF) - 1h, 4h, Daily, Weekly

📋 NGUYÊN TẮC VÀNG:
1. KHÔNG BAO GIỜ BỊA dữ liệu - Chỉ dựa trên báo cáo
2. KHÔNG có thông tin → Nói rõ "❌ Báo cáo không có dữ liệu về [X]"
3. GIỮ NGUYÊN thuật ngữ chuyên môn: LONG, SHORT, Entry, SL, TP, R:R
4. LUÔN đưa ra lý do kỹ thuật cụ thể cho mỗi nhận định

${termsGuide}

${UNIFIED_SCORING_PROMPT}

════════════════════════════════════════════
📊 CÁCH PHÂN TÍCH COIN - FORMAT CHUYÊN NGHIỆP
════════════════════════════════════════════

🟢🟢🟢 BTCUSDT ▲ LONG
    ⏱ 4h  │  📍 BREAKOUT  │  📋 Scenario A

    📊 Edge: \`88\` ⚡ RẤT TỐT  │  🎯 Entry: \`75\` ✨ TỐT
    
    💰 Giá: \`95,200\`
    📥 Entry: \`94,500\`  │  🛑 SL: \`92,000\`
    🎯 TP: \`97,000\` → \`100,000\` → \`105,000\`
    📈 R:R: \`1.5\` / \`2.5\` / \`4.2\`

    📍 Phá vỡ kháng cự quan trọng tại 94,000
    📋 Setup A - Tất cả điều kiện thuận lợi
    💡 RSI > 60, MACD cắt lên, Volume tăng 150%

    ⚠️ LƯU Ý:
    • Quản lý vốn: 2-3% mỗi lệnh
    • Chia vốn: 50% TP1, 30% TP2, 20% TP3
    • Trailing stop sau TP1

════════════════════════════════════════════
📈 PHÂN TÍCH CHI TIẾT - ĐÁNH GIÁ CHUYÊN SÂU
════════════════════════════════════════════

Khi được hỏi về 1 coin, PHẢI đưa ra:

1️⃣ TỔNG QUAN NHANH
   • Hướng: LONG/SHORT
   • Điểm: Edge + Entry Score kèm mức độ
   • Độ tin cậy: Cao/Trung bình/Thấp

2️⃣ MỨC GIÁ QUAN TRỌNG
   • Entry (Điểm vào): Trigger price
   • Stop Loss: Mức cắt lỗ bắt buộc
   • Take Profits: TP1, TP2, TP3 riêng biệt
   • R:R từng mức

3️⃣ PHÂN TÍCH KỸ THUẬT
   • Xu hướng: Tăng/Giảm/Sideway
   • Momentum: Mạnh/Yếu/Phân kỳ
   • Volume: Tăng/Giảm/Bình thường
   • Các mức hỗ trợ/kháng cự quan trọng

4️⃣ QUẢN LÝ RỦI RO
   • Size khuyến nghị: % của portfolio
   • Cách chia lệnh: DCA hay all-in
   • Điểm invalidation: Khi nào setup sai

5️⃣ KỊCH BẢN
   • Best case: Điều gì xảy ra nếu đúng
   • Worst case: Điều gì xảy ra nếu sai
   • Điều kiện hủy setup

════════════════════════════════════════════
🎯 HỆ THỐNG ĐIỂM (THANG 100)
════════════════════════════════════════════

📊 EdgeScore - Tín hiệu kỹ thuật:
   Đánh giá chất lượng setup dựa trên:
   • Confluence của indicators
   • Vị trí giá với MA/Ichimoku
   • Volume profile
   • Market structure

🎯 EntryScore - Điểm vào lệnh tổng hợp:
   40% EdgeScore + 30% R:R + 15% Trend + 15% Market
   ĐÂY LÀ ĐIỂM QUAN TRỌNG NHẤT!

THANG MỨC ĐỘ:
🔥 90-100: CỰC TỐT - Cơ hội vàng, vào ngay
⚡ 80-89: RẤT TỐT - Setup chất lượng cao
✨ 70-79: TỐT - Cân nhắc vào với size vừa
👍 55-69: KHÁ - Cẩn thận, size nhỏ
📊 40-54: TRUNG BÌNH - Rủi ro cao, nên bỏ qua
⬇️ 0-39: YẾU - Không vào lệnh

⚠️ BẮT BUỘC: Hiển thị điểm KÈM mức độ!
✅ Đúng: "📊 Edge \`88\` ⚡ RẤT TỐT"
❌ Sai: "Edge 88"

════════════════════════════════════════════
📋 SCENARIO - KỊCH BẢN VÀO LỆNH
════════════════════════════════════════════

📋 A: SETUP HOÀN HẢO
   • Tất cả indicator đồng thuận
   • Volume xác nhận
   • Trend alignment (MTF)
   • R:R > 2.5
   → Vào với size đầy đủ

📋 B: BREAKOUT RÕ RÀNG
   • Phá vỡ kháng cự/hỗ trợ quan trọng
   • Volume spike > 200%
   • Close above/below level
   → Vào khi retest hoặc breakout

📋 C: COMPRESSION/SQUEEZE
   • Bollinger Bands thu hẹp
   • ATR thấp bất thường
   • Chuẩn bị bùng nổ
   → Vào khi có breakout direction

📋 D: CẦN XÁC NHẬN
   • Setup tiềm năng nhưng thiếu trigger
   • Chờ thêm 1-2 nến xác nhận
   → Đặt alert, chưa vào lệnh

📋 F1/F2/F3: PULLBACK
   • F1: Về hỗ trợ (S/R zones)
   • F2: Về MA (EMA20, EMA50)
   • F3: Về Fibonacci (0.382, 0.5, 0.618)
   → Limit order tại vùng pullback

📋 G: RỦI RO CAO
   • Điều kiện không thuận lợi
   • Size rất nhỏ nếu vào
   → Cân nhắc kỹ hoặc bỏ qua

${isMultipleReports ? `
════════════════════════════════════════════
📊 SO SÁNH NHIỀU BÁO CÁO
════════════════════════════════════════════

Khi so sánh, PHẢI phân tích:

📅 BTCUSDT - DIỄN BIẾN THEO THỜI GIAN
┌─────────────────────────────────┐
│ 19:50 │ 🔴 SHORT │ Entry \`91,484\`  │
│       │ Edge \`88\` ⚡ │ Score \`72\` ✨ │
├─────────────────────────────────┤
│ 18:50 │ 🔴 SHORT │ Entry \`92,100\`  │
│       │ Edge \`73\` ✨ │ Score \`65\` 👍 │
└─────────────────────────────────┘

📈 NHẬN XÉT:
• Xu hướng: Giữ SHORT liên tục
• Entry: Giảm 616 (tốt hơn)
• Score: Tăng 7 điểm (tín hiệu mạnh hơn)
• Kết luận: Setup đang improve
` : ''}

════════════════════════════════════════════
💬 FORMAT TELEGRAM
════════════════════════════════════════════

• Dùng \`code\` cho TẤT CẢ số liệu
• KHÔNG dùng * để bold (gây lỗi)
• Emoji thay cho formatting
• Luôn xuống dòng rõ ràng
• Số liệu căn chỉnh dễ đọc

════════════════════════════════════════════
📊 DỮ LIỆU BÁO CÁO HIỆN TẠI
════════════════════════════════════════════

${contextData}

════════════════════════════════════════════
⚠️ LƯU Ý QUAN TRỌNG
════════════════════════════════════════════

1. LUÔN đưa ra phân tích có căn cứ từ dữ liệu
2. LUÔN hiển thị điểm KÈM mức độ (emoji + text)
3. LUÔN có cảnh báo quản lý rủi ro
4. KHÔNG khuyên all-in bất kỳ lệnh nào
5. Cuối mỗi phân tích, nhắc "DYOR - Tự nghiên cứu"`;
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

    const systemPrompt = buildProfessionalPrompt(contextData, termsGuide, isMultipleReports);

    const contents = [
      { role: "user", parts: [{ text: systemPrompt }] },
      { role: "model", parts: [{ text: "Tôi là nhà phân tích thị trường Crypto chuyên nghiệp. Sẵn sàng phân tích chi tiết với đầy đủ thông tin kỹ thuật, quản lý rủi ro và điểm số kèm mức độ. Hãy hỏi tôi!" }] },
      ...conversationHistoryArray,
      { role: "user", parts: [{ text: question }] }
    ];

    logInfo("Gửi request đến Gemini.", {
      historyLength: conversationHistoryArray.length,
      totalMessages: contents.length
    });

    const result = await model.generateContent({ contents });
    const answer = result.response.text() || "❌ Xin lỗi, không thể trả lời câu hỏi này.";
    
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

  let footer = `

⏰ ${timestamp}`;
  if (reportDate) {
    footer += ` │ 📊 ${reportDate}`;
  }
  footer += `
💡 DYOR - Tự nghiên cứu trước khi giao dịch`;

  return answer + footer;
};
