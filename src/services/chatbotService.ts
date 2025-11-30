import { GoogleGenerativeAI } from "@google/generative-ai";
import { EnvConfig } from "../config/env";
import { NormalizedMail, NormalizedReport } from "../types/mail";
import { ExternalServiceError } from "../lib/errors";
import { logDebug, logInfo } from "../utils/logger";
import { ENTRY_SCORE_RULES } from "../config/scoringRules";

// ═══════════════════════════════════════════════════════════
// CONVERSATION HISTORY - Lưu 5 câu hỏi/trả lời gần nhất
// ═══════════════════════════════════════════════════════════
// Sử dụng Multi-turn Conversation để bot hiểu ngữ cảnh liên tục
// Ví dụ:
//   User: "BTC có tín hiệu gì?"
//   Bot: "BTC có tín hiệu LONG, entry 83439..."
//   User: "Còn ETH thì sao?" ← Bot hiểu "còn...thì sao" = hỏi về tín hiệu ETH
//   Bot: "ETH có tín hiệu SHORT, entry 3200..."
//   User: "Entry của BTC là bao nhiêu?" ← Bot nhớ đã nói về BTC ở câu đầu
//   Bot: "Entry của BTC là 83,439 USDT (như đã đề cập trước đó)"
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
  
  // Chỉ giữ 5 câu mới nhất
  if (conversationHistory.length > MAX_HISTORY) {
    conversationHistory = conversationHistory.slice(0, MAX_HISTORY);
  }
  
  logInfo("Đã lưu câu hỏi/trả lời vào lịch sử.", { 
    totalHistory: conversationHistory.length,
    question: question.substring(0, 50) + "..."
  });
};

// Chuyển đổi lịch sử thành conversation history cho Gemini
// Format: [{ role: "user", parts: [{text}] }, { role: "model", parts: [{text}] }, ...]
const buildConversationHistory = () => {
  const history: Array<{ role: string; parts: Array<{ text: string }> }> = [];
  
  // Reverse để lấy từ cũ đến mới (Gemini yêu cầu thứ tự thời gian)
  const sortedHistory = [...conversationHistory].reverse();
  
  sortedHistory.forEach((item) => {
    // User message
    history.push({
      role: "user",
      parts: [{ text: item.question }]
    });
    
    // Model response
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

// Reset conversation history (nếu cần bắt đầu cuộc hội thoại mới)
export const resetConversationHistory = () => {
  const oldLength = conversationHistory.length;
  conversationHistory = [];
  logInfo("Đã reset conversation history.", { oldLength });
};

// Hàm trả lời câu hỏi dựa trên data report (hoặc mail legacy)
export const answerQuestion = async (
  config: EnvConfig,
  question: string,
  latestData: NormalizedReport | NormalizedMail | null
): Promise<string> => {
  const genAI = new GoogleGenerativeAI(config.geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: config.geminiModel,
  });

  try {
    // Build conversation history cho Gemini (multi-turn conversation)
    const conversationHistoryArray = buildConversationHistory();
    
    let contextData = "KHÔNG CÓ DỮ LIỆU NÀO.";
    
    if (latestData) {
      // Check if it's a NormalizedReport (has sectionsMarkdown)
      if ('sectionsMarkdown' in latestData) {
        const report = latestData as NormalizedReport;
        contextData = `
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
      } else {
        // Legacy: NormalizedMail
        const mail = latestData as NormalizedMail;
        contextData = `
DỮ LIỆU EMAIL MỚI NHẤT:
• *Tiêu đề:* ${mail.subject}
• *Từ:* ${mail.from}
• *Ngày:* ${mail.date}
• *Nội dung chính:* 
${mail.htmlText || mail.plainText || mail.snippet}
`;
      }
    }

    const systemPrompt = `Bạn là trợ lý phân tích tín hiệu Crypto chuyên nghiệp, có khả năng giải thích thuật ngữ một cách dễ hiểu.

NGUYÊN TẮC QUAN TRỌNG NHẤT:
━━━━━━━━━━━━━━━━━━━━━━
1. ⚠️ TUYỆT ĐỐI KHÔNG BỊA/ĐOÁN/GIẢ ĐỊNH dữ liệu không có trong report
2. ⚠️ CHỈ TRẢ LỜI DỰA TRÊN DỮ LIỆU REPORT CÓ SẴN bên dưới
3. ⚠️ Nếu report KHÔNG chứa thông tin cần thiết → Nói rõ: "❌ Report không có thông tin về [vấn đề X]"
4. ⚠️ KHÔNG sử dụng kiến thức chung về crypto để thêm thông tin không có trong report

NGUYÊN TẮC VỀ NGỮ CẢNH HỘI THOẠI:
━━━━━━━━━━━━━━━━━━━━━━
• Bạn đang trong một cuộc hội thoại liên tục với người dùng
• Nếu câu hỏi liên quan đến câu trả lời trước (VD: "còn ETH thì sao?", "Entry là bao nhiêu?", "coin nào khác?"):
  → Hiểu ngữ cảnh và trả lời dựa trên dữ liệu report hiện tại
• Nếu câu hỏi hoàn toàn mới và không liên quan:
  → Trả lời độc lập dựa trên report
• LUÔN ưu tiên dữ liệu report mới nhất, KHÔNG dựa vào memory cũ nếu report không có thông tin đó

CÁC NHIỆM VỤ:
━━━━━━━━━━━━━━━━━━━━━━
A. TRÍCH XUẤT DỮ LIỆU:
   • Đọc kỹ report và trích xuất CHÍNH XÁC thông tin được hỏi
   • Trích dẫn GIÁ TRỊ CỤ THỂ từ report (số, giá, phần trăm)
   • KHÔNG làm tròn, thay đổi hoặc ước lượng số liệu
   • Tìm các thông tin chuyên ngành: Edge Score, RR (Risk:Reward), ADX, Fear-Greed Index, Classification, Volatility
   • Chú ý các bảng trong report (thường có Entry, SL, TP1, TP2, TP3, RR, Edge Score)

B. GIẢI THÍCH THUẬT NGỮ:
   • Khi trả lời có thuật ngữ chuyên ngành → LUÔN LUÔN giải thích ngay sau thuật ngữ đó
   • Format: *Thuật ngữ* (Giải thích ngắn gọn, dễ hiểu)
   • Ví dụ tốt:
     ╰─ *Entry* (Điểm vào lệnh - Giá mua/bán để bắt đầu giao dịch)
     ╰─ *Stop Loss (SL)* (Điểm cắt lỗ - Giá tự động đóng lệnh để giới hạn thua lỗ)
     ╰─ *Take Profit (TP)* (Chốt lời - Mức giá đóng lệnh để thu lợi nhuận)
     ╰─ *LONG* (Mua lên - Đặt cược giá sẽ tăng)
     ╰─ *SHORT* (Bán xuống - Đặt cược giá sẽ giảm)
     ╰─ *Timeframe* (Khung thời gian - VD: 1h = biểu đồ 1 giờ, 4h = biểu đồ 4 giờ)
     ╰─ *R:R hay Risk:Reward* (Tỷ lệ rủi ro/lợi nhuận - VD: R:R 1:3 = Rủi ro 1$ để kiếm 3$)
     ╰─ *Edge Score* (Điểm mạnh tín hiệu - Scale 0-7, càng cao càng tốt)
     ╰─ *Entry Score* (Điểm đánh giá 0-100 - Càng cao càng tốt)

C. FORMAT TRẢ LỜI CHUYÊN NGHIỆP (TELEGRAM MARKDOWN):
   • Dùng box/separator để tách phần (━━━━━━━━━━)
   • Icon phù hợp: 📊💰🎯🛑⚡📈📉🟢🔴⚠️✅❌🔥⭐💡📥
   • *Bold* cho keywords quan trọng (dùng 1 dấu sao *)
   • _italic_ cho ghi chú (dùng dấu gạch dưới)
   • \`code\` cho số liệu (giá, TP, SL) - dùng backtick
   • Bullet points (•) hoặc ╰─ cho sub-items
   • KHÔNG dùng ** (2 dấu sao) - Telegram Markdown chỉ dùng 1 dấu *

${contextData}

QUY TRÌNH TRẢ LỜI:
━━━━━━━━━━━━━━━━━━━━━━
Bước 1: Kiểm tra report có chứa thông tin được hỏi không?
   → KHÔNG có → Trả lời: "❌ Report không có thông tin về [vấn đề này]"
   → CÓ → Tiếp tục Bước 2

Bước 2: Trích xuất CHÍNH XÁC dữ liệu từ report (không thêm/bớt/sửa)

Bước 3: Tính điểm gợi ý vào lệnh (0-100) - ÁP DỤNG CÙNG QUY TẮC:
${ENTRY_SCORE_RULES}

Bước 4: Format câu trả lời:
   • Liệt kê thông tin rõ ràng với box separator ━━━
   • Giải thích NGAY các thuật ngữ chuyên ngành
   • Dùng emoji và code block \`...\` cho số liệu
   • Thêm score ngay dưới phần TP

Bước 5: Kiểm tra lại lần cuối:
   • Có bịa thông tin nào không? → XÓA ngay
   • Có thuật ngữ nào chưa giải thích? → THÊM giải thích
   • Có tín hiệu LONG/SHORT mà thiếu score? → THÊM score

VÍ DỤ TRẢ LỜI CHUYÊN NGHIỆP (TELEGRAM MARKDOWN):
━━━━━━━━━━━━━━━━━━━━━━
Câu hỏi: "BTC có tín hiệu gì không?"

✅ TRẢ LỜI TỐT:

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
   ╰─ Edge Score 6/7, RR 1.3/2.5/4.0
   ╰─ ADX mạnh, Fear-Greed = 11

⏱ *Timeframe*: 1h (Stop-breakout)
💡 *Lý do*: _Down-trend strong, ADX > 25_

━━━━━━━━━━━━━━━━━━━━━━

❌ TRẢ LỜI XẤU (BỊA THÔNG TIN):
"BTC đang có xu hướng tăng mạnh, bạn nên mua ở 83,000 và chốt lời ở 90,000" 
→ SAI vì report không nói 90,000!

❌ TRẢ LỜI XẤU (KHÔNG CÓ SCORE):
"BTC có tín hiệu LONG, entry 83,439..."
→ SAI vì thiếu điểm đánh giá (entryScore)

HÃY BẮT ĐẦU TRẢ LỜI!`;

    // Build contents array với conversation history
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [
      // System prompt (đặt ở đầu như một "user" message để set context)
      { role: "user", parts: [{ text: systemPrompt }] },
      { role: "model", parts: [{ text: "Đã hiểu! Tôi sẽ trả lời DỰA TRÊN DỮ LIỆU REPORT, KHÔNG BỊA, giải thích thuật ngữ rõ ràng, format Markdown đẹp, và duy trì ngữ cảnh hội thoại. Hãy hỏi tôi!" }] },
      
      // Thêm conversation history (5 câu gần nhất)
      ...conversationHistoryArray,
      
      // Câu hỏi hiện tại
      { role: "user", parts: [{ text: question }] }
    ];

    logInfo("Đang gửi request đến Gemini với conversation history.", {
      historyLength: conversationHistoryArray.length,
      totalMessages: contents.length
    });

    const result = await model.generateContent({
      contents: contents,
    });

    const answer = result.response.text() || "❌ Xin lỗi, tôi không thể trả lời câu hỏi này.";
    
    // Lưu câu hỏi/trả lời vào lịch sử (chỉ lưu 5 câu gần nhất)
    const dataDate = latestData ? ('rawDate' in latestData ? latestData.date : latestData.date) : undefined;
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
