/**
 * Telegram Message Formatter
 * Sử dụng HTML format (parse_mode: HTML) - dễ dùng hơn MarkdownV2
 * 
 * Supported HTML tags:
 * - <b>bold</b>
 * - <i>italic</i>
 * - <u>underline</u>
 * - <s>strikethrough</s>
 * - <code>monospace</code>
 * - <pre>preformatted</pre>
 * - <a href="URL">link</a>
 */

import { AnalysisResult, TradingSignal } from "../types/mail";

// ════════════════════════════════════════════
// Helper functions
// ════════════════════════════════════════════

/**
 * Escape HTML entities
 */
const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
};

const getDirectionEmoji = (direction: string): string => {
  switch (direction) {
    case "LONG": return "🟢";
    case "SHORT": return "🔴";
    case "STAY_OUT": return "⚠️";
    default: return "⚪";
  }
};

const getScoreEmoji = (score: number): string => {
  if (score >= 5) return "🔥🔥🔥";
  if (score >= 4) return "🔥🔥";
  if (score >= 3) return "🔥";
  if (score >= 2) return "⭐";
  if (score >= 1) return "✨";
  return "💤";
};

const getScoreLabel = (score: number): string => {
  if (score >= 5) return "CỰC MẠNH";
  if (score >= 4) return "RẤT TỐT";
  if (score >= 3) return "TỐT";
  if (score >= 2) return "KHÁ";
  if (score >= 1) return "TRUNG BÌNH";
  return "YẾU";
};

const getEntryScoreEmoji = (score: number): string => {
  if (score >= 85) return "🔥🔥🔥";
  if (score >= 70) return "⭐⭐";
  if (score >= 55) return "⭐";
  if (score >= 40) return "⚠️";
  return "❌";
};

const formatPrice = (price: string | number | undefined): string => {
  if (!price) return "-";
  const num = typeof price === "string" ? parseFloat(price) : price;
  if (isNaN(num)) return String(price);
  
  // Format theo độ lớn của số
  if (num >= 1000) return num.toFixed(1);
  if (num >= 1) return num.toFixed(4);
  return num.toFixed(6);
};

// ════════════════════════════════════════════
// Signal Formatter
// ════════════════════════════════════════════

const formatSignalDetailed = (signal: TradingSignal, index: number): string => {
  const emoji = getDirectionEmoji(signal.direction);
  const lines: string[] = [];
  
  // Header
  lines.push(``);
  lines.push(`${emoji} <b>${index + 1}. ${escapeHtml(signal.symbol)}</b> [${signal.timeframe || "-"}] <b>${signal.direction}</b>`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
  
  // EdgeScore & Entry Score
  const edgeScore = signal.edgeScore ?? 0;
  const entryScore = signal.entryScore ?? 0;
  lines.push(`📊 <b>EdgeScore:</b> ${edgeScore}/7 ${getScoreEmoji(edgeScore)} <i>${getScoreLabel(edgeScore)}</i>`);
  if (entryScore > 0) {
    lines.push(`🎯 <b>EntryScore:</b> ${entryScore}/100 ${getEntryScoreEmoji(entryScore)}`);
  }
  
  // Scenario & EntryType
  if (signal.scenario || signal.entryType) {
    const scenario = signal.scenario ? `Scenario ${escapeHtml(signal.scenario)}` : "";
    const entryType = signal.entryType ? `(${escapeHtml(signal.entryType)})` : "";
    lines.push(`📋 <b>Setup:</b> ${scenario} ${entryType}`);
  }
  
  // Price & Entry
  lines.push(``);
  lines.push(`💰 <b>Giá hiện tại:</b> <code>${formatPrice(signal.price)}</code>`);
  if (signal.trigger && signal.trigger !== "-") {
    lines.push(`📥 <b>Trigger:</b> <code>${formatPrice(signal.trigger)}</code>`);
  } else if (signal.entry) {
    lines.push(`📥 <b>Entry:</b> <code>${formatPrice(signal.entry)}</code>`);
  }
  
  // SL & TP
  if (signal.stopLoss) {
    lines.push(`🛑 <b>Stop Loss:</b> <code>${formatPrice(signal.stopLoss)}</code>`);
  }
  
  if (signal.takeProfits && signal.takeProfits.length > 0) {
    const tps = signal.takeProfits
      .filter(tp => tp && tp !== "-")
      .map((tp, i) => `TP${i + 1}: <code>${formatPrice(tp)}</code>`)
      .join(" | ");
    if (tps) {
      lines.push(`🎯 <b>Take Profit:</b> ${tps}`);
    }
  }
  
  // RR
  if (signal.rr && signal.rr !== "-") {
    lines.push(`📈 <b>R:R:</b> ${escapeHtml(signal.rr)}`);
  }
  
  // Reason/Notes
  if (signal.reason) {
    lines.push(`💡 <i>${escapeHtml(signal.reason)}</i>`);
  }
  
  return lines.join("\n");
};

// ════════════════════════════════════════════
// Main Formatter
// ════════════════════════════════════════════

export const formatTelegramMessage = (analysis: AnalysisResult): string => {
  // Phân loại signals
  const longSignals = analysis.signals?.filter(s => s.direction === "LONG") || [];
  const shortSignals = analysis.signals?.filter(s => s.direction === "SHORT") || [];
  const totalSignals = longSignals.length + shortSignals.length;
  
  // Sắp xếp theo EdgeScore giảm dần
  const sortByEdgeScore = (a: TradingSignal, b: TradingSignal) => 
    (b.edgeScore ?? 0) - (a.edgeScore ?? 0);
  longSignals.sort(sortByEdgeScore);
  shortSignals.sort(sortByEdgeScore);

  const lines: string[] = [];
  
  // ════════════════════════════════════════════
  // HEADER
  // ════════════════════════════════════════════
  lines.push(`📊 <b>BÁO CÁO TÍN HIỆU GIAO DỊCH</b>`);
  lines.push(`═══════════════`);
  lines.push(``);
  lines.push(`📝 <b>${escapeHtml(analysis.subject)}</b>`);
  lines.push(`🗣 Nguồn: ${escapeHtml(analysis.sender)}`);
  lines.push(``);
  
  // ════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════
  lines.push(`📌 <b>TỔNG QUAN THỊ TRƯỜNG</b>`);
  lines.push(`─────────────────────────────`);
  lines.push(`<i>${escapeHtml(analysis.summary)}</i>`);
  lines.push(``);
  
  // ════════════════════════════════════════════
  // STATISTICS
  // ════════════════════════════════════════════
  lines.push(`📈 <b>THỐNG KÊ</b>`);
  lines.push(`─────────────────────────────`);
  lines.push(`• Tổng tín hiệu: <b>${totalSignals}</b>`);
  lines.push(`• 🟢 LONG: <b>${longSignals.length}</b> | 🔴 SHORT: <b>${shortSignals.length}</b>`);
  
  // Top signals by EdgeScore
  if (totalSignals > 0) {
    const allSignals = [...longSignals, ...shortSignals].sort(sortByEdgeScore);
    const topSignals = allSignals.slice(0, 3);
    if (topSignals.length > 0) {
      const topList = topSignals
        .map(s => `${getDirectionEmoji(s.direction)}${s.symbol}(${s.edgeScore ?? 0})`)
        .join(" ");
      lines.push(`• Top EdgeScore: ${topList}`);
    }
  }
  lines.push(``);
  
  // ════════════════════════════════════════════
  // LONG SIGNALS
  // ════════════════════════════════════════════
  if (longSignals.length > 0) {
    lines.push(`🟢 <b>DANH SÁCH LONG (${longSignals.length})</b>`);
    lines.push(`═══════════════`);
    longSignals.forEach((signal, index) => {
      lines.push(formatSignalDetailed(signal, index));
    });
    lines.push(``);
  }
  
  // ════════════════════════════════════════════
  // SHORT SIGNALS
  // ════════════════════════════════════════════
  if (shortSignals.length > 0) {
    lines.push(`🔴 <b>DANH SÁCH SHORT (${shortSignals.length})</b>`);
    lines.push(`═══════════════`);
    shortSignals.forEach((signal, index) => {
      lines.push(formatSignalDetailed(signal, index));
    });
    lines.push(``);
  }
  
  // No signals
  if (totalSignals === 0) {
    lines.push(`⚠️ <b>KHÔNG CÓ TÍN HIỆU</b>`);
    lines.push(`─────────────────────────────`);
    lines.push(`<i>Không tìm thấy tín hiệu LONG/SHORT trong report này.</i>`);
    lines.push(`<i>Thị trường có thể đang sideway hoặc chưa có setup tốt.</i>`);
    lines.push(``);
  }
  
  // ════════════════════════════════════════════
  // FOOTER
  // ════════════════════════════════════════════
  lines.push(`═══════════════`);
  lines.push(`🔖 Report ID: <code>${analysis.mailId}</code>`);
  lines.push(`🤖 Confidence: ${(analysis.confidence * 100).toFixed(0)}%`);
  lines.push(``);
  lines.push(`<i>⚠️ Đây chỉ là tín hiệu tham khảo. DYOR!</i>`);
  
  return lines.join("\n");
};

/**
 * Format tin nhắn ngắn gọn cho notification
 */
export const formatShortNotification = (analysis: AnalysisResult): string => {
  const longSignals = analysis.signals?.filter(s => s.direction === "LONG") || [];
  const shortSignals = analysis.signals?.filter(s => s.direction === "SHORT") || [];
  const total = longSignals.length + shortSignals.length;
  
  if (total === 0) {
    return `📊 <b>Report mới</b>\n<i>${escapeHtml(analysis.subject)}</i>\n⚠️ Không có tín hiệu LONG/SHORT`;
  }
  
  // Lấy top 3 signals theo EdgeScore
  const allSignals = [...longSignals, ...shortSignals]
    .sort((a, b) => (b.edgeScore ?? 0) - (a.edgeScore ?? 0))
    .slice(0, 3);
  
  const topList = allSignals
    .map(s => `${getDirectionEmoji(s.direction)}${s.symbol}`)
    .join(" ");
  
  return `📊 <b>Report mới - ${total} tín hiệu</b>\n🟢 ${longSignals.length} LONG | 🔴 ${shortSignals.length} SHORT\n📈 Top: ${topList}`;
};

/**
 * Format tin nhắn compact cho mỗi signal (dùng khi chia nhỏ tin nhắn)
 */
export const formatSignalCompact = (signal: TradingSignal): string => {
  const emoji = getDirectionEmoji(signal.direction);
  const edgeScore = signal.edgeScore ?? 0;
  
  const lines: string[] = [];
  lines.push(`${emoji} <b>${signal.symbol}</b> [${signal.timeframe || "-"}]`);
  lines.push(`   📊 Edge: ${edgeScore}/7 ${getScoreEmoji(edgeScore)}`);
  
  if (signal.entry || signal.trigger) {
    lines.push(`   📥 Entry: <code>${formatPrice(signal.trigger || signal.entry)}</code>`);
  }
  if (signal.stopLoss) {
    lines.push(`   🛑 SL: <code>${formatPrice(signal.stopLoss)}</code>`);
  }
  if (signal.takeProfits && signal.takeProfits.length > 0) {
    const tp1 = signal.takeProfits[0];
    if (tp1 && tp1 !== "-") {
      lines.push(`   🎯 TP1: <code>${formatPrice(tp1)}</code>`);
    }
  }
  
  return lines.join("\n");
};
