import { GoogleGenerativeAI } from "@google/generative-ai";
import { EnvConfig } from "../config/env";
import { ActionItem, AnalysisResult, NormalizedMail, TradingSignal } from "../types/mail";
import { ExternalServiceError, ProcessingError } from "../lib/errors";
import { logDebug } from "../utils/logger";
import { ENTRY_SCORE_RULES } from "../config/scoringRules";

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

${ENTRY_SCORE_RULES}

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

