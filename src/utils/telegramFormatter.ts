/**
 * TELEGRAM FORMATTER - Giao diện Mobile chuyên nghiệp
 * HTML format (parse_mode: HTML)
 */

import { AnalysisResult, TradingSignal } from "../types/mail";
import { convertEdgeScoreTo100 } from "../config/scoringRules";

// ════════════════════════════════════════════
// HELPER FUNCTIONS
// ════════════════════════════════════════════

const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
};

const getDirectionStyle = (direction: string): { icon: string; bg: string; label: string } => {
  switch (direction) {
    case "LONG": return { icon: "🟢", bg: "📈", label: "LONG" };
    case "SHORT": return { icon: "🔴", bg: "📉", label: "SHORT" };
    case "STAY_OUT": return { icon: "⚪", bg: "⏸", label: "STAY OUT" };
    default: return { icon: "⚫", bg: "❓", label: direction };
  }
};

const getScoreInfo = (score: number): { stars: string; label: string; emoji: string } => {
  if (score >= 90) return { stars: "★★★★★", label: "XUẤT SẮC", emoji: "🔥" };
  if (score >= 80) return { stars: "★★★★☆", label: "RẤT TỐT", emoji: "⭐" };
  if (score >= 70) return { stars: "★★★☆☆", label: "TỐT", emoji: "✨" };
  if (score >= 55) return { stars: "★★☆☆☆", label: "KHÁ", emoji: "👍" };
  if (score >= 40) return { stars: "★☆☆☆☆", label: "TB", emoji: "⚠️" };
  return { stars: "☆☆☆☆☆", label: "YẾU", emoji: "❌" };
};

const formatPrice = (price: string | number | undefined): string => {
  if (!price || price === "-") return "—";
  const num = typeof price === "string" ? parseFloat(price) : price;
  if (isNaN(num)) return String(price);
  
  if (num >= 10000) return num.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (num >= 100) return num.toFixed(2);
  if (num >= 1) return num.toFixed(4);
  return num.toFixed(6);
};

// Tạo mô tả chi tiết cho coin
const generateDescription = (signal: TradingSignal): string => {
  const parts: string[] = [];
  
  // Scenario description
  if (signal.scenario) {
    const scenarioDesc: { [key: string]: string } = {
      "A": "Setup hoàn hảo, xu hướng mạnh",
      "B": "Setup tốt, breakout rõ ràng", 
      "C": "Setup khá, compression pattern",
      "D": "Setup trung bình, cần xác nhận",
      "F1": "Pullback về vùng hỗ trợ",
      "F2": "Pullback về MA",
      "F3": "Pullback về Fibo",
      "G": "Setup rủi ro, cẩn thận"
    };
    parts.push(scenarioDesc[signal.scenario] || `Scenario ${signal.scenario}`);
  }
  
  // Entry type description
  if (signal.entryType) {
    const entryDesc: { [key: string]: string } = {
      "stop_breakout": "Vào khi phá vỡ",
      "limit_pullback": "Chờ hồi về rồi vào",
      "market_now": "Vào ngay giá hiện tại"
    };
    parts.push(entryDesc[signal.entryType] || signal.entryType);
  }
  
  // Original reason
  if (signal.reason) {
    parts.push(signal.reason);
  }
  
  return parts.join(". ") || "Không có mô tả";
};

// ════════════════════════════════════════════
// FORMAT SIGNAL CARD - Card đẹp cho mỗi coin
// ════════════════════════════════════════════

const formatSignalCard = (signal: TradingSignal, index: number): string => {
  const dir = getDirectionStyle(signal.direction);
  
  // Điểm số
  const edgeScore7 = signal.edgeScore ?? 0;
  const edgeScore100 = convertEdgeScoreTo100(edgeScore7);
  const entryScore = signal.entryScore ?? edgeScore100;
  const mainScore = Math.max(edgeScore100, entryScore);
  const scoreInfo = getScoreInfo(mainScore);
  
  const lines: string[] = [];
  
  // ═══════════════════════════════════════
  // HEADER - Tên coin nổi bật
  // ═══════════════════════════════════════
  lines.push(``);
  lines.push(`╔══════════════════════════╗`);
  lines.push(`║ ${dir.bg} <b>${escapeHtml(signal.symbol)}</b>`);
  lines.push(`║ ${dir.icon} <b>${dir.label}</b> │ ⏱ ${signal.timeframe || "4h"}`);
  lines.push(`╠══════════════════════════╣`);
  
  // ═══════════════════════════════════════
  // ĐIỂM SỐ
  // ═══════════════════════════════════════
  lines.push(`║ ${scoreInfo.emoji} <b>ĐIỂM:</b> <code>${mainScore}</code>/100`);
  lines.push(`║    ${scoreInfo.stars} ${scoreInfo.label}`);
  
  // ═══════════════════════════════════════
  // GIÁ HIỆN TẠI
  // ═══════════════════════════════════════
  if (signal.price && signal.price !== "-") {
    lines.push(`╠══════════════════════════╣`);
    lines.push(`║ 💰 <b>Giá hiện tại:</b>`);
    lines.push(`║    <code>${formatPrice(signal.price)}</code> USDT`);
  }
  
  // ═══════════════════════════════════════
  // ENTRY / SL / TP
  // ═══════════════════════════════════════
  lines.push(`╠══════════════════════════╣`);
  
  const entryPrice = signal.trigger || signal.entry;
  if (entryPrice && entryPrice !== "-") {
    lines.push(`║ 📥 <b>Entry:</b> <code>${formatPrice(entryPrice)}</code>`);
  }
  
  if (signal.stopLoss && signal.stopLoss !== "-") {
    lines.push(`║ 🛑 <b>SL:</b> <code>${formatPrice(signal.stopLoss)}</code>`);
  }
  
  if (signal.takeProfits && signal.takeProfits.length > 0) {
    const validTPs = signal.takeProfits.filter(tp => tp && tp !== "-");
    if (validTPs.length > 0) {
      lines.push(`║ 🎯 <b>TP:</b>`);
      validTPs.slice(0, 3).forEach((tp, i) => {
        lines.push(`║    TP${i + 1}: <code>${formatPrice(tp)}</code>`);
      });
    }
  }
  
  // ═══════════════════════════════════════
  // R:R
  // ═══════════════════════════════════════
  if (signal.rr && signal.rr !== "-") {
    lines.push(`║ 📈 <b>R:R:</b> ${escapeHtml(signal.rr)}`);
  }
  
  // ═══════════════════════════════════════
  // MÔ TẢ CHI TIẾT
  // ═══════════════════════════════════════
  lines.push(`╠══════════════════════════╣`);
  const description = generateDescription(signal);
  // Chia mô tả thành nhiều dòng nếu dài
  const descLines = description.match(/.{1,28}/g) || [description];
  lines.push(`║ 💡 <b>Phân tích:</b>`);
  descLines.forEach(line => {
    lines.push(`║    <i>${escapeHtml(line)}</i>`);
  });
  
  lines.push(`╚══════════════════════════╝`);
  
  return lines.join("\n");
};

// ════════════════════════════════════════════
// MAIN FORMATTER
// ════════════════════════════════════════════

export const formatTelegramMessage = (analysis: AnalysisResult): string => {
  const longSignals = analysis.signals?.filter(s => s.direction === "LONG") || [];
  const shortSignals = analysis.signals?.filter(s => s.direction === "SHORT") || [];
  const stayOutCount = analysis.signals?.filter(s => s.direction === "STAY_OUT").length || 0;
  const total = longSignals.length + shortSignals.length;
  
  // Sort theo điểm
  const sortByScore = (a: TradingSignal, b: TradingSignal) => {
    const scoreA = Math.max(convertEdgeScoreTo100(a.edgeScore ?? 0), a.entryScore ?? 0);
    const scoreB = Math.max(convertEdgeScoreTo100(b.edgeScore ?? 0), b.entryScore ?? 0);
    return scoreB - scoreA;
  };
  longSignals.sort(sortByScore);
  shortSignals.sort(sortByScore);

  const lines: string[] = [];
  
  // ═══════════════════════════════════════
  // HEADER
  // ═══════════════════════════════════════
  const now = new Date().toLocaleString('vi-VN', { 
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
  
  lines.push(`┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓`);
  lines.push(`┃  📊 <b>BÁO CÁO TÍN HIỆU</b>        ┃`);
  lines.push(`┃  ⏰ ${now}     ┃`);
  lines.push(`┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`);
  lines.push(``);
  
  // ═══════════════════════════════════════
  // THỐNG KÊ
  // ═══════════════════════════════════════
  lines.push(`📈 <b>THỐNG KÊ TỔNG QUAN</b>`);
  lines.push(`┌────────────────────────────┐`);
  lines.push(`│ 📊 Tổng tín hiệu: <b>${total}</b>`);
  lines.push(`│ 🟢 LONG: <b>${longSignals.length}</b>  │  🔴 SHORT: <b>${shortSignals.length}</b>`);
  if (stayOutCount > 0) {
    lines.push(`│ ⚪ STAY OUT: <b>${stayOutCount}</b>`);
  }
  
  // Top coins
  if (total > 0) {
    const allSignals = [...longSignals, ...shortSignals].sort(sortByScore);
    const top3 = allSignals.slice(0, 3);
    lines.push(`│`);
    lines.push(`│ 🏆 <b>TOP 3:</b>`);
    top3.forEach((s, i) => {
      const dir = getDirectionStyle(s.direction);
      const score = Math.max(convertEdgeScoreTo100(s.edgeScore ?? 0), s.entryScore ?? 0);
      lines.push(`│    ${i + 1}. ${dir.icon} ${s.symbol} (${score}đ)`);
    });
  }
  lines.push(`└────────────────────────────┘`);
  lines.push(``);
  
  // ═══════════════════════════════════════
  // TỔNG QUAN THỊ TRƯỜNG
  // ═══════════════════════════════════════
  if (analysis.summary) {
    lines.push(`📌 <b>TỔNG QUAN THỊ TRƯỜNG</b>`);
    lines.push(`┌────────────────────────────┐`);
    const summaryLines = analysis.summary.match(/.{1,30}/g) || [analysis.summary];
    summaryLines.slice(0, 4).forEach(line => {
      lines.push(`│ <i>${escapeHtml(line)}</i>`);
    });
    lines.push(`└────────────────────────────┘`);
    lines.push(``);
  }
  
  // ═══════════════════════════════════════
  // DANH SÁCH LONG
  // ═══════════════════════════════════════
  if (longSignals.length > 0) {
    lines.push(`🟢🟢🟢 <b>DANH SÁCH LONG (${longSignals.length})</b> 🟢🟢🟢`);
    longSignals.forEach((signal, index) => {
      lines.push(formatSignalCard(signal, index + 1));
    });
    lines.push(``);
  }
  
  // ═══════════════════════════════════════
  // DANH SÁCH SHORT
  // ═══════════════════════════════════════
  if (shortSignals.length > 0) {
    lines.push(`🔴🔴🔴 <b>DANH SÁCH SHORT (${shortSignals.length})</b> 🔴🔴🔴`);
    shortSignals.forEach((signal, index) => {
      lines.push(formatSignalCard(signal, index + 1));
    });
    lines.push(``);
  }
  
  // Không có tín hiệu
  if (total === 0) {
    lines.push(`╔══════════════════════════╗`);
    lines.push(`║ ⚠️ <b>KHÔNG CÓ TÍN HIỆU</b>     ║`);
    lines.push(`║                          ║`);
    lines.push(`║ Thị trường đang sideway  ║`);
    lines.push(`║ hoặc chưa có setup tốt.  ║`);
    lines.push(`╚══════════════════════════╝`);
    lines.push(``);
  }
  
  // ═══════════════════════════════════════
  // FOOTER
  // ═══════════════════════════════════════
  lines.push(`┌────────────────────────────┐`);
  lines.push(`│ 🔖 ID: <code>${analysis.mailId?.substring(0, 12) || '-'}...</code>`);
  lines.push(`│ ⚠️ <i>Chỉ tham khảo. Luôn DYOR!</i>`);
  lines.push(`└────────────────────────────┘`);
  
  return lines.join("\n");
};

// ════════════════════════════════════════════
// SHORT NOTIFICATION
// ════════════════════════════════════════════

export const formatShortNotification = (analysis: AnalysisResult): string => {
  const longSignals = analysis.signals?.filter(s => s.direction === "LONG") || [];
  const shortSignals = analysis.signals?.filter(s => s.direction === "SHORT") || [];
  const total = longSignals.length + shortSignals.length;
  
  if (total === 0) {
    return `📊 <b>Báo cáo mới</b>\n⚠️ Không có tín hiệu LONG/SHORT`;
  }
  
  const sortByScore = (a: TradingSignal, b: TradingSignal) => {
    const scoreA = Math.max(convertEdgeScoreTo100(a.edgeScore ?? 0), a.entryScore ?? 0);
    const scoreB = Math.max(convertEdgeScoreTo100(b.edgeScore ?? 0), b.entryScore ?? 0);
    return scoreB - scoreA;
  };
  
  const top3 = [...longSignals, ...shortSignals].sort(sortByScore).slice(0, 3);
  const topList = top3.map(s => `${getDirectionStyle(s.direction).icon}${s.symbol}`).join(" ");
  
  return `📊 <b>BÁO CÁO MỚI</b> - ${total} tín hiệu\n\n🟢 LONG: ${longSignals.length}  |  🔴 SHORT: ${shortSignals.length}\n\n🏆 Top: ${topList}`;
};

// ════════════════════════════════════════════
// COMPACT SIGNAL
// ════════════════════════════════════════════

export const formatSignalCompact = (signal: TradingSignal): string => {
  const dir = getDirectionStyle(signal.direction);
  const score = Math.max(convertEdgeScoreTo100(signal.edgeScore ?? 0), signal.entryScore ?? 0);
  const scoreInfo = getScoreInfo(score);
  
  const lines: string[] = [];
  lines.push(`${dir.icon} <b>${signal.symbol}</b> ${dir.label}`);
  lines.push(`   📊 ${score}/100 ${scoreInfo.stars}`);
  
  if (signal.price && signal.price !== "-") {
    lines.push(`   💰 Giá: <code>${formatPrice(signal.price)}</code>`);
  }
  
  const entry = signal.trigger || signal.entry;
  if (entry && entry !== "-") {
    lines.push(`   📥 Entry: <code>${formatPrice(entry)}</code>`);
  }
  
  const description = generateDescription(signal);
  if (description) {
    lines.push(`   💡 <i>${escapeHtml(description.substring(0, 40))}...</i>`);
  }
  
  return lines.join("\n");
};
