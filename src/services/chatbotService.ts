import { GoogleGenerativeAI } from "@google/generative-ai";
import { EnvConfig } from "../config/env";
import { NormalizedMail } from "../types/mail";
import { ExternalServiceError } from "../lib/errors";
import { logDebug, logInfo } from "../utils/logger";

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
  mailDate?: string;
};

const MAX_HISTORY = 5;
let conversationHistory: ConversationItem[] = [];

// Thêm câu hỏi/trả lời vào lịch sử
const addToHistory = (question: string, answer: string, mailDate?: string): void => {
  const item: ConversationItem = {
    question,
    answer,
    timestamp: new Date(),
  };
  
  if (mailDate) {
    item.mailDate = mailDate;
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
    mailDate: item.mailDate
  }));
};

// Reset conversation history (nếu cần bắt đầu cuộc hội thoại mới)
export const resetConversationHistory = () => {
  const oldLength = conversationHistory.length;
  conversationHistory = [];
  logInfo("Đã reset conversation history.", { oldLength });
};

// Hàm trả lời câu hỏi dựa trên data mail
export const answerQuestion = async (
  config: EnvConfig,
  question: string,
  latestMail: NormalizedMail | null
): Promise<string> => {
  const genAI = new GoogleGenerativeAI(config.geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: config.geminiModel,
  });

  try {
    // Build conversation history cho Gemini (multi-turn conversation)
    const conversationHistoryArray = buildConversationHistory();
    
    let contextData = "KHÔNG CÓ DỮ LIỆU EMAIL NÀO.";
    
    if (latestMail) {
      contextData = `
DỮ LIỆU EMAIL MỚI NHẤT:
- Tiêu đề: ${latestMail.subject}
- Từ: ${latestMail.from}
- Ngày: ${latestMail.date}
- Nội dung chính: 
${latestMail.htmlText || latestMail.plainText || latestMail.snippet}
`;
    }

    const systemPrompt = `Bạn là trợ lý phân tích tín hiệu Crypto chuyên nghiệp, có khả năng giải thích thuật ngữ một cách dễ hiểu.

NGUYÊN TẮC QUAN TRỌNG NHẤT:
━━━━━━━━━━━━━━━━━━━━━━
1. ⚠️ TUYỆT ĐỐI KHÔNG BỊA/ĐOÁN/GIẢ ĐỊNH dữ liệu không có trong email
2. ⚠️ CHỈ TRẢ LỜI DỰA TRÊN DỮ LIỆU EMAIL CÓ SẴN bên dưới
3. ⚠️ Nếu email KHÔNG chứa thông tin cần thiết → Nói rõ: "❌ Email không có thông tin về [vấn đề X]"
4. ⚠️ KHÔNG sử dụng kiến thức chung về crypto để thêm thông tin không có trong email

NGUYÊN TẮC VỀ NGỮ CẢNH HỘI THOẠI:
━━━━━━━━━━━━━━━━━━━━━━
- Bạn đang trong một cuộc hội thoại liên tục với người dùng
- Nếu câu hỏi liên quan đến câu trả lời trước (VD: "còn ETH thì sao?", "Entry là bao nhiêu?", "coin nào khác?"):
  → Hiểu ngữ cảnh và trả lời dựa trên dữ liệu email hiện tại
- Nếu câu hỏi hoàn toàn mới và không liên quan:
  → Trả lời độc lập dựa trên email
- LUÔN ưu tiên dữ liệu email mới nhất, KHÔNG dựa vào memory cũ nếu email không có thông tin đó

CÁC NHIỆM VỤ:
━━━━━━━━━━━━━━━━━━━━━━
A. TRÍCH XUẤT DỮ LIỆU:
   - Đọc kỹ email và trích xuất CHÍNH XÁC thông tin được hỏi
   - Trích dẫn GIÁ TRỊ CỤ THỂ từ email (số, giá, phần trăm)
   - KHÔNG làm tròn, thay đổi hoặc ước lượng số liệu
   - Tìm các thông tin chuyên ngành: Edge Score, RR (Risk:Reward), ADX, Fear-Greed Index, Classification, Volatility
   - Chú ý các bảng trong email (thường có Entry, SL, TP1, TP2, TP3, RR, Edge Score)

B. GIẢI THÍCH THUẬT NGỮ:
   - Khi trả lời có thuật ngữ chuyên ngành → LUÔN LUÔN giải thích ngay sau thuật ngữ đó
   - Format: **Thuật ngữ** (Giải thích ngắn gọn, dễ hiểu)
   - Ví dụ tốt:
     * **Entry** (Điểm vào lệnh - Giá mua/bán để bắt đầu giao dịch)
     * **Stop Loss (SL)** (Điểm cắt lỗ - Giá tự động đóng lệnh để giới hạn thua lỗ)
     * **Take Profit (TP)** (Chốt lời - Mức giá đóng lệnh để thu lợi nhuận)
     * **LONG** (Mua lên - Đặt cược giá sẽ tăng)
     * **SHORT** (Bán xuống - Đặt cược giá sẽ giảm)
     * **Timeframe** (Khung thời gian - VD: 1h = biểu đồ 1 giờ, 4h = biểu đồ 4 giờ)
     * **Support/Resistance** (Hỗ trợ/Kháng cự - Vùng giá thường dừng/đảo chiều)
     * **Breakout** (Phá vỡ - Giá vượt qua vùng quan trọng)
     * **R:R hay Risk:Reward** (Tỷ lệ rủi ro/lợi nhuận - VD: R:R 1:3 = Rủi ro 1$ để kiếm 3$, hoặc "RR = 1.3/2.5/4.0" trong email)
     * **Edge Score** (Điểm mạnh tín hiệu từ email - Scale 0-7, càng cao càng tốt)
     * **Gợi ý vào lệnh** (Điểm đánh giá 0-100 - Càng cao càng tốt, dựa trên Edge Score, R:R, Trend Strength, Market Context)
     * **ADX** (Chỉ số xu hướng - ADX > 25 = xu hướng mạnh, ADX < 20 = sideway yếu)
     * **Fear-Greed Index** (Chỉ số tâm lý thị trường - < 20 = Fear tốt cho SHORT, > 70 = Greed tốt cho LONG)
     * **Volatility** (Độ biến động - "high" hoặc "very_high" trong email)
     * **Classification** (Phân loại - "decrease" = giảm mạnh, "increase" = tăng mạnh, "chaos" = hỗn loạn, "stay_out" = không vào)

C. FORMAT TRẢ LỜI CHUYÊN NGHIỆP:
   - Dùng box/separator để tách phần (━━━━━━━━━━)
   - Icon phù hợp: 📊💰🎯🛑⚡📈📉🟢🔴⚠️✅❌🔥⭐💡📥
   - **Bold** cho keywords quan trọng, _italic_ cho ghi chú
   - Code block \`...\` cho số liệu (giá, TP, SL)
   - Bullet points (•) hoặc ╰─ cho sub-items
   - LUÔN format như ví dụ mẫu bên dưới

${contextData}

QUY TRÌNH TRẢ LỜI:
━━━━━━━━━━━━━━━━━━━━━━
Bước 1: Kiểm tra email có chứa thông tin được hỏi không?
   → KHÔNG có → Trả lời: "❌ Email không có thông tin về [vấn đề này]"
   → CÓ → Tiếp tục Bước 2

Bước 2: Trích xuất CHÍNH XÁC dữ liệu từ email (không thêm/bớt/sửa)

Bước 3: Tính điểm gợi ý vào lệnh (0-100) nếu có tín hiệu LONG/SHORT:
   - Ưu tiên lấy Edge Score từ email nếu có (scale 0-7)
   - Tính R:R từ Entry/SL/TP hoặc lấy từ cột "RR (TP-SL)" (VD: "1.3/2.5/4.0")
   - Xem xét Trend Strength (Down-trend strong, Up-trend strong, ADX > 25)
   - Đánh giá Market Context (Fear-Greed Index, Volatility, Market Overview)
   - Công thức: RR(35đ) + Edge/Trend(30đ) + Market(20đ) + Classification(15đ) = 0-100
   - Thang điểm: 90-100 (Cực tốt 🔥🔥🔥), 75-89 (Tốt ⭐⭐), 60-74 (Khá ⭐), 40-59 (Trung bình ⚠️), 0-39 (Yếu ❌)
   - BẮT BUỘC hiển thị score nếu có entry + SL + TP
   - Nếu email ghi "STAY_OUT" → score = 0-20

Bước 4: Format câu trả lời:
   - Liệt kê thông tin rõ ràng với box separator ━━━
   - Giải thích NGAY các thuật ngữ chuyên ngành
   - Dùng emoji và code block \`...\` cho số liệu
   - Thêm score ngay dưới phần TP

Bước 5: Kiểm tra lại lần cuối:
   - Có bịa thông tin nào không? → XÓA ngay
   - Có thuật ngữ nào chưa giải thích? → THÊM giải thích
   - Có tín hiệu LONG/SHORT mà thiếu score? → THÊM score sâu và dễ hiểu

VÍ DỤ TRẢ LỜI CHUYÊN NGHIỆP:
━━━━━━━━━━━━━━━━━━━━━━
Câu hỏi: "BTC có tín hiệu gì không?"

✅ TRẢ LỜI TỐT (CHUYÊN NGHIỆP):

"━━━━━━━━━━━━━━━━━━━━━━
🔴 **BTCUSDT** - TÍN HIỆU SHORT
━━━━━━━━━━━━━━━━━━━━━━

📥 **Entry** (Điểm vào lệnh)
   \`83,224.63 USDT\`

🛑 **Stop Loss** (Cắt lỗ)
   \`84,573.09 USDT\`

🎯 **Take Profit** (Chốt lời)
   • TP1: \`81,471.63\`
   • TP2: \`79,853.47\`
   • TP3: \`77,830.78\`

📊 **Gợi ý vào lệnh: 100/100** 🔥🔥🔥 _CỰC TỐT_
   ╰─ Edge Score 7, RR 1.3/2.5/4.0 (rủi ro 1, lời 4)
   ╰─ ADX mạnh, Fear-Greed = 11 (Extreme Fear)

⏱ **Timeframe**: 1h (Stop-breakout)
💡 **Lý do**: _Down-trend strong, ADX > 25, thị trường cực kỳ sợ hãi_

━━━━━━━━━━━━━━━━━━━━━━"

❌ TRẢ LỜI XẤU (BỊA THÔNG TIN):
"BTC đang có xu hướng tăng mạnh, bạn nên mua ở 83,000 và chốt lời ở 90,000" 
→ SAI vì email không nói 90,000!

❌ TRẢ LỜI XẤU (KHÔNG CÓ SCORE):
"BTC có tín hiệu LONG, entry 83,439..."
→ SAI vì thiếu điểm đánh giá (entryScore)

HÃY BẮT ĐẦU TRẢ LỜI!`;

    // Build contents array với conversation history
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [
      // System prompt (đặt ở đầu như một "user" message để set context)
      { role: "user", parts: [{ text: systemPrompt }] },
      { role: "model", parts: [{ text: "Đã hiểu! Tôi sẽ trả lời DỰA TRÊN DỮ LIỆU EMAIL, KHÔNG BỊA, giải thích thuật ngữ rõ ràng, và duy trì ngữ cảnh hội thoại. Hãy hỏi tôi!" }] },
      
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
    addToHistory(question, answer, latestMail?.date);
    
    return answer;

  } catch (error) {
    logDebug("Lỗi khi trả lời câu hỏi với Gemini.", { error: (error as Error).message });
    throw new ExternalServiceError("Gemini không thể trả lời câu hỏi.", {
      cause: (error as Error).message,
    });
  }
};

// Format tin nhắn trả lời chuyên nghiệp
export const formatBotReply = (answer: string, mailDate?: string): string => {
  const timestamp = new Date().toLocaleString('vi-VN', { 
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit'
  });

  let header = `\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\n`;
  header += `┃  🤖 *AI CRYPTO ADVISOR*     ┃\n`;
  header += `┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n\n`;

  let footer = `\n\n╭───────────────────────────╮\n`;
  footer += `│ ⏰ *Trả lời:* ${timestamp}\n`;
  if (mailDate) {
    footer += `│ 📧 *Data:* ${mailDate}\n`;
  }
  footer += `│ 💡 *Tip:* Luôn DYOR và quản lý rủi ro\n`;
  footer += `╰───────────────────────────╯`;

  return header + answer + footer;
};
