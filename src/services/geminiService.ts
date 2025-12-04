import { GoogleGenerativeAI } from "@google/generative-ai";
import { EnvConfig } from "../config/env";
import { ActionItem, AnalysisResult, NormalizedMail, NormalizedReport, TradingSignal } from "../types/mail";
import { ExternalServiceError, ProcessingError } from "../lib/errors";
import { logDebug } from "../utils/logger";
import { UNIFIED_SCORING_PROMPT, convertEdgeScoreTo100, getScoreLevel } from "../config/scoringRules";

// ════════════════════════════════════════════════════════════════════════════════
// BUILD PROMPT
// ════════════════════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════════════════════
// RAW ANALYSIS TYPES
// ════════════════════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════════════════════
// CALCULATE ENTRY SCORE - Thống nhất với scoringRules.ts
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Tính EntryScore (thang 100) từ các yếu tố
 * Công thức thống nhất với UNIFIED_SCORING_PROMPT
 */
const calculateEntryScore = (edgeScore100: number, rr?: string, direction?: string): number => {
  let score = 0;
  
  // 1. EdgeScore đóng góp 40% (max 40 điểm)
  score += edgeScore100 * 0.4;
  
  // 2. R:R đóng góp 30% (max 30 điểm)
  if (rr) {
    const rrValues = rr.split('/').map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
    const maxRR = Math.max(...rrValues, 0);
    
    if (maxRR >= 4.0) score += 30;
    else if (maxRR >= 3.0) score += 27;
    else if (maxRR >= 2.5) score += 24;
    else if (maxRR >= 2.0) score += 20;
    else if (maxRR >= 1.5) score += 15;
    else if (maxRR >= 1.0) score += 10;
    else score += 5;
  } else {
    score += 10; // Mặc định nếu không có RR
  }
  
  // 3. Hướng đi đóng góp 15% (max 15 điểm)
  if (direction === "LONG" || direction === "SHORT") {
    score += 15; // Có hướng rõ ràng
  } else if (direction === "STAY_OUT") {
    return Math.min(20, score); // STAY_OUT tối đa 20 điểm
  } else {
    score += 5; // NEUTRAL hoặc không rõ
  }
  
  // 4. Điều kiện thị trường đóng góp 15% (mặc định 10 vì không có data cụ thể)
  score += 10;
  
  return Math.min(100, Math.max(0, Math.round(score)));
};

// ════════════════════════════════════════════════════════════════════════════════
// SANITIZE SIGNALS
// ════════════════════════════════════════════════════════════════════════════════

const sanitizeSignals = (items?: TradingSignal[]): TradingSignal[] => {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item && typeof item.symbol === "string")
    .map((item): TradingSignal => {
      // Lấy EdgeScore gốc (thang 7)
      const edgeScore7 = typeof item.edgeScore === 'number' ? item.edgeScore : 0;
      
      // Chuyển EdgeScore sang thang 100
      const edgeScore100 = convertEdgeScoreTo100(edgeScore7);
      
      // Tính EntryScore nếu không có hoặc không hợp lệ
      let entryScore = item.entryScore;
      if (typeof entryScore !== 'number' || entryScore < 0 || entryScore > 100) {
        entryScore = calculateEntryScore(edgeScore100, item.rr, item.direction);
      }
      
      // Log để debug
      const level = getScoreLevel(entryScore);
      logDebug(`Signal ${item.symbol}: Edge7=${edgeScore7} → Edge100=${edgeScore100}, Entry=${entryScore} (${level.labelVi})`);
      
      return {
        symbol: item.symbol.trim().toUpperCase(),
        direction: ["LONG", "SHORT", "STAY_OUT", "NEUTRAL"].includes(item.direction) ? item.direction : "NEUTRAL",
        entry: item.entry ? String(item.entry).trim() : undefined,
        stopLoss: item.stopLoss ? String(item.stopLoss).trim() : undefined,
        takeProfits: Array.isArray(item.takeProfits) ? item.takeProfits.map(tp => String(tp)) : [],
        reason: item.reason ? item.reason.trim() : undefined,
        timeframe: item.timeframe ? item.timeframe.trim() : undefined,
        entryScore: Math.round(entryScore),
        // Thông tin chi tiết
        price: item.price ? String(item.price).trim() : undefined,
        trigger: item.trigger ? String(item.trigger).trim() : undefined,
        entryType: item.entryType ? item.entryType.trim() : undefined,
        scenario: item.scenario ? item.scenario.trim() : undefined,
        edgeScore: edgeScore7, // Giữ nguyên thang 7 để hiển thị gốc
        rr: item.rr ? item.rr.trim() : undefined,
      };
    });
};

// ════════════════════════════════════════════════════════════════════════════════
// SYSTEM INSTRUCTION - Thống nhất với scoringRules.ts
// ════════════════════════════════════════════════════════════════════════════════

const SYSTEM_INSTRUCTION = `BẠN LÀ NHÀ PHÂN TÍCH KỸ THUẬT CRYPTO CHUYÊN NGHIỆP

🎯 VAI TRÒ:
- Nhà phân tích kỹ thuật với kinh nghiệm 10+ năm trên thị trường tài chính
- Chuyên gia trích xuất và đánh giá tín hiệu giao dịch từ báo cáo
- Hiểu sâu về Price Action, Volume Analysis, và các Technical Indicators

📋 NHIỆM VỤ:
Trích xuất CHÍNH XÁC và ĐẦY ĐỦ tất cả tín hiệu giao dịch LONG/SHORT từ report.
Đánh giá chất lượng từng tín hiệu bằng hệ thống điểm chuyên nghiệp.

════════════════════════════════════════════
📊 CẤU TRÚC REPORT
════════════════════════════════════════════

Report có format markdown với các bảng quan trọng:

1️⃣ Per-Timeframe Decision Table - Phân tích chi tiết:
   | Symbol | TF | Decision | PlanSide | EntryType | Price | Scenario | Trigger | SL | TP1 | TP2 | TP3 | Nearest_S | Nearest_R | Notes |
   
2️⃣ Final Conclusion - KẾT LUẬN CUỐI (ƯU TIÊN):
   | Symbol | TF | Side | PlanSide | EntryType | Price | Trigger | SL | TP1 | TP2 | TP3 | RR1 | RR2 | RR3 | Notes |

3️⃣ Summary - Thống kê tổng quan:
   - Total snapshots analyzed
   - STAY_OUT / LONG / SHORT counts

════════════════════════════════════════════
📌 CÁC TRƯỜNG DỮ LIỆU CẦN TRÍCH XUẤT
════════════════════════════════════════════

THÔNG TIN CƠ BẢN:
• Symbol: Mã coin (BTCUSDT, ETHUSDT...)
• TF/Timeframe: Khung thời gian (4h, 1h, 15m)
• Decision/Side: Hướng giao dịch (LONG, SHORT, STAY_OUT)
• Price: Giá hiện tại

MỨC GIÁ QUAN TRỌNG:
• Trigger: Giá kích hoạt vào lệnh → Dùng làm Entry
• SL (Stop Loss): Mức cắt lỗ bắt buộc
• TP1, TP2, TP3: Các mức chốt lời
• RR1, RR2, RR3: Risk:Reward ratio tương ứng

THÔNG TIN KỸ THUẬT:
• EntryType: limit_pullback | stop_breakout | market_now
• Scenario: Loại setup (A, B, C, D, F1, F2, F3, G)
• EdgeScore: Trong Notes "EdgeScore=X.X" (thang 0-7)
• Nearest_S/R: Hỗ trợ/kháng cự gần nhất

${UNIFIED_SCORING_PROMPT}

════════════════════════════════════════════
📋 GIẢI THÍCH SCENARIO
════════════════════════════════════════════

A: Setup hoàn hảo - Tất cả indicator đồng thuận
B: Breakout rõ ràng - Volume xác nhận
C: Compression/Squeeze - BB thu hẹp, sắp bùng nổ
D: Cần xác nhận thêm - Chờ trigger
F1: Pullback về hỗ trợ/kháng cự
F2: Pullback về Moving Average
F3: Pullback về Fibonacci retracement
G: Rủi ro cao - Cần quản lý vốn chặt

════════════════════════════════════════════
📤 OUTPUT JSON FORMAT
════════════════════════════════════════════

Trả về JSON THUẦN (không bọc markdown):
{
  "subject": "Tiêu đề report",
  "sender": "FutureSignal API",
  "summary": "Tóm tắt thị trường từ Summary: X tín hiệu LONG, Y tín hiệu SHORT...",
  "signals": [
    {
      "symbol": "BTCUSDT",
      "direction": "LONG",
      "timeframe": "4h",
      "price": "95200",
      "trigger": "94500",
      "entry": "94500",
      "stopLoss": "92000",
      "takeProfits": ["97000", "100000", "105000"],
      "entryType": "stop_breakout",
      "scenario": "B",
      "edgeScore": 5.5,
      "rr": "1.50/2.50/4.20",
      "reason": "Breakout kháng cự 94000 với volume tăng, RSI > 60",
      "entryScore": 75
    }
  ],
  "actionItems": [],
  "confidence": 0.9
}

════════════════════════════════════════════
⚠️ QUY TẮC BẮT BUỘC
════════════════════════════════════════════

1. ƯU TIÊN bảng "Final Conclusion" - đây là kết luận cuối cùng
2. CHỈ lấy tín hiệu LONG và SHORT (bỏ qua STAY_OUT)
3. Entry = Trigger (nếu có), hoặc Price (nếu không có Trigger)
4. TRÍCH XUẤT CHÍNH XÁC số liệu từ bảng - KHÔNG làm tròn
5. EdgeScore từ Notes: "EdgeScore=X.X" → edgeScore: X.X (thang 0-7)
6. R:R format: "RR1/RR2/RR3" (VD: "1.30/2.50/4.00")
7. entryScore tính theo công thức UNIFIED_SCORING_PROMPT (thang 0-100)
8. Scenario: Lấy ký tự đầu (A, B, C, D, F1, F2, F3, G)
9. reason: Mô tả ngắn gọn lý do kỹ thuật (từ Notes hoặc Scenario)
10. KHÔNG BỊA số liệu - chỉ trích xuất từ report
11. Nếu có nhiều List, lấy TẤT CẢ tín hiệu từ TỪNG bảng Final Conclusion`;

// ════════════════════════════════════════════════════════════════════════════════
// ANALYZE MAIL (Legacy - từ Gmail)
// ════════════════════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════════════════════
// ANALYZE REPORT (New - từ API)
// ════════════════════════════════════════════════════════════════════════════════

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
