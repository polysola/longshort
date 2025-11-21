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

const formatSignal = (signal: TradingSignal): string => {
  const parts = [
    `--------------------------------`,
    `🔹 *${escapeText(signal.symbol)}* ${signal.timeframe ? `(${escapeText(signal.timeframe)})` : ""}`,
    `   ${getSignalIcon(signal.direction)}`,
  ];

  if (signal.direction === "LONG" || signal.direction === "SHORT") {
    if (signal.entry) parts.push(`   📥 Entry: ${escapeText(signal.entry)}`);
    if (signal.stopLoss) parts.push(`   🛑 SL: ${escapeText(signal.stopLoss)}`);
    if (signal.takeProfits && signal.takeProfits.length > 0) {
      parts.push(`   🎯 TP: ${signal.takeProfits.map(escapeText).join(" | ")}`);
    }
  }

  if (signal.reason) {
    parts.push(`   📝 ${escapeText(signal.reason)}`);
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
