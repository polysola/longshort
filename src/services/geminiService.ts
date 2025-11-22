import { GoogleGenerativeAI } from "@google/generative-ai";
import { EnvConfig } from "../config/env";
import { ActionItem, AnalysisResult, NormalizedMail, TradingSignal } from "../types/mail";
import { ExternalServiceError, ProcessingError } from "../lib/errors";
import { logDebug } from "../utils/logger";

const buildPrompt = (mail: NormalizedMail): string => {
  const lines = [
    `Subject: ${mail.subject}`,
    `From: ${mail.from}`,
    `To: ${mail.to}`,
    `Date: ${mail.date}`,
    `Snippet: ${mail.snippet}`,
    "Body:",
    mail.htmlText || mail.plainText || "(no body)",
  ];

  return lines.join("\n");
};

type RawAnalysis = {
  subject?: string;
  sender?: string;
  summary?: string;
  actionItems?: AnalysisResult["actionItems"];
  dueDate?: string;
  confidence?: number;
  signals?: TradingSignal[];
};

const parseAnalysis = (text: string, mailId: string): RawAnalysis => {
  try {
    // Gemini đôi khi trả về markdown block ```json ... ```, cần clean đi
    const cleanedText = text.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleanedText) as RawAnalysis;
  } catch {
    throw new ProcessingError("Gemini trả về dữ liệu không phải JSON hợp lệ.", {
      mailId,
      raw: text,
    });
  }
};

const sanitizeNumber = (value?: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }
  return 0.5;
};

const sanitizeActionItems = (items?: RawAnalysis["actionItems"]): ActionItem[] => {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is ActionItem => typeof item?.title === "string" && item.title.trim().length > 0)
    .map((item): ActionItem => ({
      title: item.title.trim(),
      owner: item.owner ? item.owner.trim() : undefined,
      dueDate: item.dueDate ? item.dueDate.trim() : undefined,
      priority: item.priority ? item.priority.trim() : undefined,
    }));
};

const sanitizeSignals = (items?: TradingSignal[]): TradingSignal[] => {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item && typeof item.symbol === "string")
    .map((item): TradingSignal => ({
      symbol: item.symbol.trim().toUpperCase(),
      direction: ["LONG", "SHORT", "STAY_OUT", "NEUTRAL"].includes(item.direction) ? (item.direction as any) : "NEUTRAL",
      entry: item.entry ? item.entry.trim() : undefined,
      stopLoss: item.stopLoss ? item.stopLoss.trim() : undefined,
      takeProfits: Array.isArray(item.takeProfits) ? item.takeProfits : [],
      reason: item.reason ? item.reason.trim() : undefined,
      timeframe: item.timeframe ? item.timeframe.trim() : undefined,
      entryScore: typeof item.entryScore === 'number' && item.entryScore >= 0 && item.entryScore <= 100 
        ? Math.round(item.entryScore) 
        : undefined,
    }));
};

const SYSTEM_INSTRUCTION = `Bạn là chuyên gia phân tích tín hiệu Crypto chuyên nghiệp.
Nhiệm vụ: Trích xuất danh sách TẤT CẢ các tín hiệu giao dịch từ email và đánh giá độ tốt của từng tín hiệu.

Trả về JSON (không bọc trong markdown) cấu trúc:
{
  "subject": "string",
  "sender": "string",
  "summary": "Tóm tắt chung về thị trường (ngắn gọn)",
  "signals": [
    {
      "symbol": "BTCUSDT",
      "direction": "LONG" | "SHORT" | "STAY_OUT" | "NEUTRAL",
      "entry": "Giá vào (VD: 83439)",
      "stopLoss": "Giá SL (VD: 84100)",
      "takeProfits": ["TP1", "TP2", "TP3"],
      "reason": "Lý do ngắn gọn",
      "timeframe": "1h" (nếu có),
      "entryScore": 85
    }
  ],
  "actionItems": [],
  "confidence": 0.9
}

QUAN TRỌNG - CÁCH TÍNH entryScore (0-100):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
entryScore đánh giá độ TỐT của tín hiệu dựa trên CHÍNH XÁC dữ liệu email:

**BƯỚC 1: TÍNH R:R (Risk:Reward) - 35 điểm**
   Công thức: R:R = (Entry - TP) / (SL - Entry)
   - R:R >= 3.0 (VD: 1.3/2.5/4.0, hoặc RR=4.0) → 35 điểm
   - R:R 2.0-2.9 → 30 điểm
   - R:R 1.5-1.9 → 25 điểm
   - R:R 1.0-1.4 → 15 điểm
   - R:R < 1.0 → 5 điểm

**BƯỚC 2: EDGE SCORE / TREND STRENGTH - 30 điểm**
   Nếu email có "Edge Score" (VD: "Edge = 7", "Edge Score* = 7"):
   - Edge Score 7 → 30 điểm
   - Edge Score 6 → 25 điểm
   - Edge Score 5 → 20 điểm
   - Edge Score 3-4 → 15 điểm
   - Edge Score ≤ 2 → 10 điểm
   
   Nếu KHÔNG có Edge Score, dựa vào Trend:
   - "Down-trend strong" / "Up-trend strong" + "ADX > 25" → 30 điểm
   - "Down-trend" / "Up-trend" (không strong) → 20 điểm
   - "Sideways" → 10 điểm

**BƯỚC 3: MARKET CONTEXT - 20 điểm**
   Dựa vào Fear-Greed Index, Volatility, Market Overview:
   - Xu hướng rõ + điều kiện thuận lợi (VD: Fear=11 cho SHORT, Greed>70 cho LONG) → 20 điểm
   - Volatility "high" + Regime "trending" → 15 điểm
   - Volatility "very_high" + Regime "volatile" → 5 điểm (rủi ro cao)
   - Sideway market → 10 điểm

**BƯỚC 4: CLASSIFICATION & DECISION - 15 điểm**
   - Classification = "decrease" hoặc "increase" (có hướng rõ) + Decision = SHORT/LONG → 15 điểm
   - Classification = "decrease"/"increase" nhưng confidence < 0.5 → 10 điểm
   - Classification = "chaos" hoặc Decision = "STAY_OUT" → 0 điểm

**THANG ĐIỂM CUỐI CÙNG:**
- **90-100**: Tín hiệu CỰC TỐT (Highly Recommended) 🔥🔥🔥
  * Edge Score 7 + RR >= 3.0 + Market thuận lợi + Classification rõ ràng
- **75-89**: Tín hiệu TỐT (Recommended) ⭐⭐
  * Edge Score 5-6 + RR >= 2.0 + Trend strong
- **60-74**: Tín hiệu KHÁ (Consider) ⭐
  * Edge Score 3-4 + RR >= 1.5 + Có setup
- **40-59**: Tín hiệu TRUNG BÌNH (Caution) ⚠️
  * Edge Score thấp hoặc RR < 1.5
- **0-39**: Tín hiệu YẾU (Not Recommended) ❌
  * STAY_OUT, chaos, hoặc điều kiện không rõ ràng

**LƯU Ý QUAN TRỌNG:**
- Nếu email ghi "STAY_OUT" → entryScore = 0-20 (không vào lệnh)
- Nếu có "Edge Score" trong email → ƯU TIÊN dùng để chấm điểm
- RR thường ở cột "RR (TP-SL)" (VD: "1.3 / 2.5 / 4.0" → lấy 4.0)
- Fear-Greed Index < 20 → TỐT cho SHORT, > 70 → TỐT cho LONG

**VÍ DỤ CHẤM ĐIỂM TỪ EMAIL THỰC TẾ:**

Email nói: "BTCUSDT - Edge Score = 7, RR = 1.3/2.5/4.0, Down-trend strong, ADX > 25, Fear-Greed = 11"
→ entryScore = 35 (RR 4.0) + 30 (Edge 7) + 20 (Fear=11 tốt cho SHORT) + 15 (decrease) = **100 điểm** 🔥🔥🔥

Email nói: "ASTERUSDT - STAY OUT - Edge Score = 4, không có 4h strong"
→ entryScore = 0 (STAY_OUT) ❌

Email nói: "DYMUSDT - LONG, Edge Score không rõ, Up-trend strong, ADX=52, RR TP1≈1.3"
→ entryScore = 15 (RR 1.3) + 30 (trend strong + ADX>25) + 15 (up-trend) + 15 (increase) = **75 điểm** ⭐⭐

Lưu ý:
- Nếu một coin có nhiều timeframe, hãy chọn timeframe ƯU TIÊN (thường là ngắn hạn 1h hoặc 4h có tín hiệu mạnh nhất).
- Nếu là bảng tổng hợp, hãy lấy hết các đồng có tín hiệu LONG/SHORT. Đồng nào STAY_OUT có thể bỏ qua hoặc vẫn lấy nếu quan trọng.
- entryScore là BẮT BUỘC cho mọi tín hiệu LONG/SHORT, giúp trader đánh giá nhanh.
- Đọc kỹ email, trích xuất chính xác Edge Score, RR, Trend, Market context để chấm điểm.`;

export const analyzeMail = async (
  config: EnvConfig,
  mail: NormalizedMail,
): Promise<AnalysisResult> => {
  const genAI = new GoogleGenerativeAI(config.geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: config.geminiModel,
    systemInstruction: SYSTEM_INSTRUCTION,
  });

  try {
    const prompt = `Phân tích email sau:\n\n${buildPrompt(mail)}`;

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
      }
    });

    const outputText = result.response.text();
    
    if (!outputText) throw new ProcessingError("Thiếu dữ liệu phản hồi Gemini.", { mailId: mail.id });

    const parsed = parseAnalysis(outputText, mail.id);
    if (!parsed.subject) throw new ProcessingError("Gemini thiếu subject.", { mailId: mail.id });

    return {
      mailId: mail.id,
      subject: parsed.subject,
      sender: parsed.sender || "",
      summary: parsed.summary || "",
      actionItems: sanitizeActionItems(parsed.actionItems),
      confidence: sanitizeNumber(parsed.confidence),
      signals: sanitizeSignals(parsed.signals),
    };
  } catch (error) {
    if (error instanceof ProcessingError) throw error;
    throw new ExternalServiceError("Gemini phân tích thất bại.", {
      mailId: mail.id,
      cause: (error as Error).message,
    });
  } finally {
    logDebug("Đã gọi Gemini phân tích email.", { mailId: mail.id });
  }
};

