import { GoogleGenerativeAI } from "@google/generative-ai";
import { EnvConfig } from "../config/env";
import { NormalizedMail } from "../types/mail";
import { ExternalServiceError } from "../lib/errors";
import { logDebug } from "../utils/logger";

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

    const systemPrompt = `Bạn là trợ lý phân tích tín hiệu Crypto thông minh.

NHIỆM VỤ:
- Trả lời câu hỏi của người dùng DỰA TRÊN DỮ LIỆU EMAIL THỰC TẾ bên dưới.
- TUYỆT ĐỐI KHÔNG ĐƯỢC BỊA HOẶC ĐOÁN dữ liệu không có trong email.
- Nếu email không chứa thông tin để trả lời câu hỏi, hãy nói rõ "Email không có thông tin về vấn đề này."
- Trả lời ngắn gọn, súc tích, có trích dẫn từ email nếu có.
- Nếu câu hỏi về tín hiệu (signal), giá (price), TP/SL, entry, hãy trích xuất CHÍNH XÁC từ email.

${contextData}

QUAN TRỌNG: Chỉ dựa vào dữ liệu email trên. Không sử dụng kiến thức chung về crypto nếu email không đề cập.`;

    const result = await model.generateContent({
      contents: [
        { role: "user", parts: [{ text: systemPrompt }] },
        { role: "user", parts: [{ text: `Câu hỏi: ${question}` }] }
      ],
    });

    const answer = result.response.text();
    return answer || "Xin lỗi, tôi không thể trả lời câu hỏi này.";

  } catch (error) {
    logDebug("Lỗi khi trả lời câu hỏi với Gemini.", { error: (error as Error).message });
    throw new ExternalServiceError("Gemini không thể trả lời câu hỏi.", {
      cause: (error as Error).message,
    });
  }
};

