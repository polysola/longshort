import { GoogleGenerativeAI } from "@google/generative-ai";
import { EnvConfig } from "../config/env";
import { NormalizedMail } from "../types/mail";
import { ExternalServiceError } from "../lib/errors";
import { logDebug, logInfo } from "../utils/logger";

// ═══════════════════════════════════════════════════════════
// CONVERSATION HISTORY - Lưu 5 câu hỏi/trả lời gần nhất
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

// Lấy lịch sử để đưa vào prompt
const getHistoryContext = (): string => {
  if (conversationHistory.length === 0) {
    return "LỊCH SỬ: Chưa có cuộc hội thoại trước đó.";
  }
  
  let context = "\n━━━━━━━━━━━━━━━━━━━━━━\n";
  context += "📚 LỊCH SỬ 5 CÂU HỎI GẦN NHẤT:\n";
  context += "━━━━━━━━━━━━━━━━━━━━━━\n";
  
  conversationHistory.forEach((item, index) => {
    const time = item.timestamp.toLocaleString('vi-VN', { 
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    context += `\n${index + 1}️⃣ [${time}] CÂU HỎI: "${item.question}"\n`;
    context += `   💬 TRẢ LỜI: ${item.answer.substring(0, 200)}...\n`;
  });
  
  context += "\n⚠️ LƯU Ý KHI SỬ DỤNG LỊCH SỬ:\n";
  context += "- Chỉ tham khảo lịch sử nếu câu hỏi HIỆN TẠI liên quan (VD: 'còn ETH thì sao?', 'coin nào khác?')\n";
  context += "- LUÔN ƯU TIÊN dữ liệu email mới nhất\n";
  context += "- KHÔNG lấy thông tin từ lịch sử nếu câu hỏi hoàn toàn mới/không liên quan\n";
  context += "- KHÔNG bịa thêm thông tin dựa trên lịch sử\n";
  context += "━━━━━━━━━━━━━━━━━━━━━━\n\n";
  
  return context;
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
    // Lấy lịch sử 5 câu hỏi gần nhất
    const historyContext = getHistoryContext();
    
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

${historyContext}

CÁC NHIỆM VỤ:
━━━━━━━━━━━━━━━━━━━━━━
A. TRÍCH XUẤT DỮ LIỆU:
   - Đọc kỹ email và trích xuất CHÍNH XÁC thông tin được hỏi
   - Trích dẫn GIÁ TRỊ CỤ THỂ từ email (số, giá, phần trăm)
   - KHÔNG làm tròn, thay đổi hoặc ước lượng số liệu

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
     * **R:R hay Risk:Reward** (Tỷ lệ rủi ro/lợi nhuận - VD: R:R 1:3 = Rủi ro 1$ để kiếm 3$)

C. FORMAT TRẢ LỜI:
   - Cấu trúc rõ ràng với bullet points (•) hoặc numbered list
   - Dùng emoji phù hợp: 📊 💰 🎯 🛑 ⚡ 📈 📉 🟢 🔴 ⚠️ ✅ ❌
   - Highlight thông tin quan trọng bằng **bold**
   - Tách đoạn để dễ đọc

${contextData}

QUY TRÌNH TRẢ LỜI:
━━━━━━━━━━━━━━━━━━━━━━
Bước 1: Kiểm tra email có chứa thông tin được hỏi không?
   → KHÔNG có → Trả lời: "❌ Email không có thông tin về [vấn đề này]"
   → CÓ → Tiếp tục Bước 2

Bước 2: Trích xuất CHÍNH XÁC dữ liệu từ email (không thêm/bớt/sửa)

Bước 3: Format câu trả lời:
   - Liệt kê thông tin rõ ràng
   - Giải thích NGAY các thuật ngữ chuyên ngành
   - Dùng emoji để dễ nhìn

Bước 4: Kiểm tra lại lần cuối:
   - Có bịa thông tin nào không? → XÓA ngay
   - Có thuật ngữ nào chưa giải thích? → THÊM giải thích

VÍ DỤ TRẢ LỜI TỐT:
━━━━━━━━━━━━━━━━━━━━━━
Câu hỏi: "BTC có tín hiệu gì không?"

✅ TRẢ LỜI TỐT:
"🟢 **BTCUSDT** có tín hiệu **LONG** (Mua lên)

📍 **Entry** (Điểm vào lệnh): 83,439 USDT
🛑 **Stop Loss** (Cắt lỗ): 84,100 USDT
🎯 **Take Profit** (Chốt lời):
   • TP1: 82,500
   • TP2: 81,800
   • TP3: 81,000

⏰ **Timeframe** (Khung thời gian): 1h (Biểu đồ 1 giờ)
💡 **Lý do**: Email đề cập "xu hướng giảm ngắn hạn sau khi test vùng kháng cự"

⚠️ **Lưu ý**: R:R (Tỷ lệ rủi ro/lợi nhuận) khoảng 1:3 - rủi ro nhỏ hơn lợi nhuận."

❌ TRẢ LỜI XẤU (BỊA THÔNG TIN):
"BTC đang có xu hướng tăng mạnh, bạn nên mua ở 83,000 và chốt lời ở 90,000" 
→ SAI vì email không nói 90,000!

HÃY BẮT ĐẦU TRẢ LỜI!`;

    const result = await model.generateContent({
      contents: [
        { role: "user", parts: [{ text: systemPrompt }] },
        { role: "user", parts: [{ text: `Câu hỏi: ${question}` }] }
      ],
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

// Format tin nhắn trả lời đẹp mắt
export const formatBotReply = (answer: string, mailDate?: string): string => {
  const timestamp = new Date().toLocaleString('vi-VN', { 
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit'
  });

  let header = `╔═══════════════════════╗\n`;
  header += `║  🤖 *CRYPTO ASSISTANT*  ║\n`;
  header += `╚═══════════════════════╝\n\n`;

  let footer = `\n\n━━━━━━━━━━━━━━━━━━━━━━\n`;
  footer += `⏰ *Trả lời lúc:* ${timestamp}\n`;
  if (mailDate) {
    footer += `📧 *Dữ liệu từ email:* ${mailDate}\n`;
  }
  footer += `━━━━━━━━━━━━━━━━━━━━━━`;

  return header + answer + footer;
};
