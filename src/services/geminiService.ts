import { GoogleGenerativeAI } from "@google/generative-ai";
import { EnvConfig } from "../config/env";
import { ActionItem, AnalysisResult, NormalizedMail, NormalizedReport, TradingSignal } from "../types/mail";
import { ExternalServiceError, ProcessingError } from "../lib/errors";
import { logDebug } from "../utils/logger";
import { ENTRY_SCORE_RULES } from "../config/scoringRules";

// Legacy: Build prompt từ NormalizedMail
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

// New: Build prompt từ NormalizedReport (API)
const buildReportPrompt = (report: NormalizedReport): string => {
  const markdown = report.sectionsMarkdown[0] || "";
  
  const lines = [
    `Report ID: ${report.id}`,
    `Subject: ${report.subject}`,
    `From: ${report.from}`,
    `Date: ${report.date}`,
    `Report Type: ${report.reportType}`,
    `Symbols (${report.symbols.length}): ${report.symbols.join(", ")}`,
    "",
    "=== MARKDOWN CONTENT ===",
    "",
    markdown,
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

const parseAnalysis = (text: string, reportId: string): RawAnalysis => {
  try {
    // Gemini đôi khi trả về markdown block ```json ... ```, cần clean đi
    const cleanedText = text.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleanedText) as RawAnalysis;
  } catch {
    throw new ProcessingError("Gemini trả về dữ liệu không phải JSON hợp lệ.", {
      reportId,
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
      direction: ["LONG", "SHORT", "STAY_OUT", "NEUTRAL"].includes(item.direction) ? item.direction : "NEUTRAL",
      entry: item.entry ? String(item.entry).trim() : undefined,
      stopLoss: item.stopLoss ? String(item.stopLoss).trim() : undefined,
      takeProfits: Array.isArray(item.takeProfits) ? item.takeProfits.map(tp => String(tp)) : [],
      reason: item.reason ? item.reason.trim() : undefined,
      timeframe: item.timeframe ? item.timeframe.trim() : undefined,
      entryScore: typeof item.entryScore === 'number' && item.entryScore >= 0 && item.entryScore <= 100 
        ? Math.round(item.entryScore) 
        : undefined,
      // Thông tin chi tiết
      price: item.price ? String(item.price).trim() : undefined,
      trigger: item.trigger ? String(item.trigger).trim() : undefined,
      entryType: item.entryType ? item.entryType.trim() : undefined,
      scenario: item.scenario ? item.scenario.trim() : undefined,
      edgeScore: typeof item.edgeScore === 'number' ? item.edgeScore : undefined,
      rr: item.rr ? item.rr.trim() : undefined,
    }));
};

const SYSTEM_INSTRUCTION = `Bạn là chuyên gia phân tích tín hiệu Crypto chuyên nghiệp.
Nhiệm vụ: Trích xuất danh sách TẤT CẢ các tín hiệu giao dịch từ report và đánh giá độ tốt của từng tín hiệu.

QUAN TRỌNG - CẤU TRÚC REPORT:
Report có format markdown với các bảng chứa thông tin chi tiết:

1. **Per-Timeframe Decision Table** - Bảng phân tích theo từng timeframe:
   | Symbol | TF | Decision | PlanSide | EntryType | Price | Scenario | Trigger | SL | TP1 | TP2 | TP3 | Nearest_S | Nearest_R | Notes |
   
2. **Final Conclusion** - Bảng kết luận cuối (ƯU TIÊN LẤY TỪ BẢNG NÀY):
   | Symbol | TF | Side | PlanSide | EntryType | Price | Trigger | SL | TP1 | TP2 | TP3 | RR1 | RR2 | RR3 | Notes |

3. **Summary** - Tổng kết:
   - Total snapshots
   - STAY_OUT, LONG, SHORT counts

CÁC CỘT QUAN TRỌNG CẦN TRÍCH XUẤT:
- Symbol: Tên coin (BTCUSDT, ETHUSDT, ...)
- TF: Timeframe (4h, 1h, 15m)
- Decision/Side: LONG, SHORT, hoặc STAY_OUT
- Price: Giá hiện tại
- Trigger: Giá trigger vào lệnh (QUAN TRỌNG - dùng làm Entry)
- SL: Stop Loss
- TP1, TP2, TP3: Take Profit levels
- RR1, RR2, RR3: Risk:Reward ratio
- EntryType: limit_pullback, stop_breakout, market_now
- Scenario: A, B, C, D, F1, F2, F3, G - loại setup
- EdgeScore: Trong Notes, format "EdgeScore=X.X" (0-7)

Trả về JSON (không bọc trong markdown) cấu trúc:
{
  "subject": "string",
  "sender": "string",
  "summary": "Tóm tắt ngắn gọn về thị trường dựa trên Summary trong report",
  "signals": [
    {
      "symbol": "BTCUSDT",
      "direction": "LONG",
      "timeframe": "1h",
      "price": "91262",
      "trigger": "91327.7",
      "entry": "91327.7",
      "stopLoss": "91447.8",
      "takeProfits": ["91231.5", "91205.1", "91143.8"],
      "entryType": "stop_breakout",
      "scenario": "C",
      "edgeScore": 2.0,
      "rr": "0.80/1.02/1.53",
      "reason": "Compression breakout setup",
      "entryScore": 65
    }
  ],
  "actionItems": [],
  "confidence": 0.9
}

${ENTRY_SCORE_RULES}

QUY TẮC TRÍCH XUẤT:
1. ƯU TIÊN lấy tín hiệu từ bảng "Final Conclusion" vì đây là kết luận cuối cùng.
2. Chỉ trích xuất tín hiệu có Side/Decision = LONG hoặc SHORT (bỏ qua STAY_OUT).
3. Entry = Trigger nếu có, nếu không dùng Price.
4. Trích xuất CHÍNH XÁC các giá trị số từ bảng (SL, TP1, TP2, TP3, RR1, RR2, RR3).
5. EdgeScore lấy từ Notes (VD: "EdgeScore=2.0" -> edgeScore: 2.0).
6. RR format: "RR1/RR2/RR3" (VD: "1.30/2.50/4.00").
7. entryScore tính từ EdgeScore (x14), RR, và Scenario theo công thức trong ENTRY_SCORE_RULES.
8. Scenario lấy ký tự đầu (A, B, C, D, F1, F2, F3, G) từ cột Scenario hoặc Notes.
9. KHÔNG bịa số liệu - chỉ trích xuất từ report.
10. Nếu có nhiều List (List 1, List 2, ...), lấy TẤT CẢ tín hiệu LONG/SHORT từ các bảng Final Conclusion.`;

// Legacy: Phân tích từ NormalizedMail (Gmail)
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
    const prompt = `Phân tích report sau:\n\n${buildPrompt(mail)}`;

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
      }
    });

    const outputText = result.response.text();
    
    if (!outputText) throw new ProcessingError("Thiếu dữ liệu phản hồi Gemini.", { reportId: mail.id });

    const parsed = parseAnalysis(outputText, mail.id);
    if (!parsed.subject) throw new ProcessingError("Gemini thiếu subject.", { reportId: mail.id });

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
      reportId: mail.id,
      cause: (error as Error).message,
    });
  } finally {
    logDebug("Đã gọi Gemini phân tích.", { reportId: mail.id });
  }
};

// New: Phân tích từ NormalizedReport (API)
export const analyzeReport = async (
  config: EnvConfig,
  report: NormalizedReport,
): Promise<AnalysisResult> => {
  const genAI = new GoogleGenerativeAI(config.geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: config.geminiModel,
    systemInstruction: SYSTEM_INSTRUCTION,
  });

  try {
    const reportPrompt = buildReportPrompt(report);
    const prompt = `Phân tích report trading sau:\n\n${reportPrompt}`;
    
    // Debug log để xem prompt
    logDebug("Prompt gửi đến Gemini.", {
      reportId: report.id,
      symbolCount: report.symbols.length,
      promptLength: prompt.length,
      promptPreview: prompt.substring(0, 800),
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
      }
    });

    const outputText = result.response.text();
    
    if (!outputText) throw new ProcessingError("Thiếu dữ liệu phản hồi Gemini.", { reportId: report.id });

    const parsed = parseAnalysis(outputText, report.id);
    if (!parsed.subject) throw new ProcessingError("Gemini thiếu subject.", { reportId: report.id });

    return {
      mailId: report.id,
      subject: parsed.subject || report.subject,
      sender: parsed.sender || report.from,
      summary: parsed.summary || "",
      actionItems: sanitizeActionItems(parsed.actionItems),
      confidence: sanitizeNumber(parsed.confidence),
      signals: sanitizeSignals(parsed.signals),
    };
  } catch (error) {
    if (error instanceof ProcessingError) throw error;
    throw new ExternalServiceError("Gemini phân tích report thất bại.", {
      reportId: report.id,
      cause: (error as Error).message,
    });
  } finally {
    logDebug("Đã gọi Gemini phân tích report.", { reportId: report.id });
  }
};
