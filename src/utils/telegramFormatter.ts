import { AnalysisResult, TradingSignal } from "../types/mail";

const escapeText = (text: string): string => text.replace(/\s+/g, " ").trim();

const getSignalIcon = (direction: string) => {
  switch (direction) {
    case "LONG":
      return "🟢 LONG";
    case "SHORT":
      return "🔴 SHORT";
    case "STAY_OUT":
      return "⚠️ STAY OUT";
    default:
      return "⚪ NEUTRAL";
  }
};

const getScoreDisplay = (score?: number): string => {
  if (!score) return "";
  
  let icon = "";
  let label = "";
  
  if (score >= 90) {
    icon = "🔥🔥🔥";
    label = "CỰC TỐT";
  } else if (score >= 75) {
    icon = "⭐⭐";
    label = "TỐT";
  } else if (score >= 60) {
    icon = "⭐";
    label = "KHÁ";
  } else if (score >= 40) {
    icon = "⚠️";
    label = "TRUNG BÌNH";
  } else {
    icon = "❌";
    label = "YẾU";
  }
  
  return `\n   ╰─ 📊 *GỢI Ý VÀO LỆNH: ${score}/100* ${icon} _${label}_`;
};

const formatSignal = (signal: TradingSignal): string => {
  const parts = [
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🔹 *${escapeText(signal.symbol)}* ${signal.timeframe ? `⏱ ${escapeText(signal.timeframe)}` : ""}`,
    `   ${getSignalIcon(signal.direction)}`,
  ];

  if (signal.direction === "LONG" || signal.direction === "SHORT") {
    if (signal.entry) parts.push(`   📥 *Entry:* \`${escapeText(signal.entry)}\``);
    if (signal.stopLoss) parts.push(`   🛑 *Stop Loss:* \`${escapeText(signal.stopLoss)}\``);
    if (signal.takeProfits && signal.takeProfits.length > 0) {
      parts.push(`   🎯 *Take Profit:*`);
      signal.takeProfits.forEach((tp, index) => {
        parts.push(`      • TP${index + 1}: \`${escapeText(tp)}\``);
      });
    }
    
    // Thêm score ngay dưới TP
    if (signal.entryScore) {
      parts.push(getScoreDisplay(signal.entryScore));
    }
  }

  if (signal.reason) {
    parts.push(`   💡 *Lý do:* _${escapeText(signal.reason)}_`);
  }

  return parts.join("\n");
};

export const formatTelegramMessage = (analysis: AnalysisResult): string => {
  const header = [
    "📬 *Báo Cáo Tín Hiệu Mới*",
    `🗣 *Từ:* ${escapeText(analysis.sender)}`,
    `📝 *Chủ đề:* ${escapeText(analysis.subject)}`,
    "",
    `📌 *Tổng quan:* ${escapeText(analysis.summary)}`,
  ];

  const signalDetails =
    analysis.signals && analysis.signals.length > 0
      ? analysis.signals.map(formatSignal).join("\n")
      : "\n(Không tìm thấy tín hiệu cụ thể trong email này)";

  const footer = [
    "",
    `🔖 ID: \`${analysis.mailId}\``,
    `🤖 Confidence: ${(analysis.confidence * 100).toFixed(0)}%`,
  ];

  return [...header, signalDetails, ...footer].join("\n");
};
