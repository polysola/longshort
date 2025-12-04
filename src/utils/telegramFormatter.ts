/**
 * TELEGRAM FORMATTER - Tiếng Việt, TỔNG QUAN lên đầu
 * HTML format (parse_mode: HTML)
 */

import { AnalysisResult, TradingSignal } from "../types/mail";
import { convertEdgeScoreTo100, getScoreLevel, getScoreEmoji } from "../config/scoringRules";

// ════════════════════════════════════════════
// HELPER FUNCTIONS
// ════════════════════════════════════════════

const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
};

const getDirectionStyle = (direction: string): { icon: string; label: string; labelVi: string; color: string } => {
  switch (direction) {
    case "LONG": return { icon: "▲", label: "LONG", labelVi: "MUA", color: "🟢" };
    case "SHORT": return { icon: "▼", label: "SHORT", labelVi: "BÁN", color: "🔴" };
    case "STAY_OUT": return { icon: "◆", label: "WAIT", labelVi: "CHỜ", color: "⚪" };
    default: return { icon: "●", label: direction, labelVi: direction, color: "⚫" };
  }
};

const getEntryTypeLabel = (entryType: string | undefined): { short: string; full: string } => {
  switch (entryType) {
    case "stop_breakout": return { short: "BREAKOUT", full: "Phá vỡ kháng cự/hỗ trợ" };
    case "limit_pullback": return { short: "LIMIT", full: "Chờ giá hồi về" };
    case "market_now": return { short: "MARKET", full: "Vào ngay" };
    default: return { short: "", full: "" };
  }
};

const getScenarioDesc = (scenario: string | undefined): string => {
  switch (scenario) {
    case "A": return "Setup hoàn hảo - Tất cả điều kiện thuận lợi";
    case "B": return "Breakout rõ ràng - Phá vỡ với volume";
    case "C": return "Compression - Giá nén chặt, sắp bùng nổ";
    case "D": return "Cần xác nhận - Chờ thêm tín hiệu";
    case "F1": return "Pullback về vùng hỗ trợ quan trọng";
    case "F2": return "Pullback về đường MA";
    case "F3": return "Pullback về mức Fibonacci";
    case "G": return "Rủi ro cao - Quản lý vốn chặt chẽ";
    default: return "";
  }
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

// ════════════════════════════════════════════
// FORMAT SIGNAL CARD - Rõ ràng và đầy đủ
// ════════════════════════════════════════════

const formatSignalCard = (signal: TradingSignal, index: number): string => {
  const dir = getDirectionStyle(signal.direction);
  const entryTypeInfo = getEntryTypeLabel(signal.entryType);
  
  // 2 điểm - đều thang 100
  const edgeScore7 = signal.edgeScore ?? 0;
  const edgeScore100 = convertEdgeScoreTo100(edgeScore7);
  const entryScore = signal.entryScore ?? 0;
  
  // Lấy mức độ
  const edgeLevel = getScoreLevel(edgeScore100);
  const entryLevel = getScoreLevel(entryScore);
  
  const lines: string[] = [];
  
  // ═══════════════════════════════════════════
  // HEADER - Nổi bật
  // ═══════════════════════════════════════════
  lines.push(``);
  lines.push(`${dir.color}${dir.color}${dir.color} <b>${index}. ${escapeHtml(signal.symbol)}</b> ${dir.icon} <b>${dir.label}</b>`);
  
  // Thông tin phụ: Timeframe, Entry Type, Scenario
  const subInfo: string[] = [];
  if (signal.timeframe) subInfo.push(`⏱ ${signal.timeframe}`);
  if (entryTypeInfo.short) subInfo.push(`📍 ${entryTypeInfo.short}`);
  if (signal.scenario) subInfo.push(`📋 Scenario ${signal.scenario}`);
  if (subInfo.length > 0) {
    lines.push(`    ${subInfo.join('  │  ')}`);
  }
  
  // ═══════════════════════════════════════════
  // SCORES - 2 loại điểm với mức độ
  // ═══════════════════════════════════════════
  lines.push(``);
  lines.push(`    📊 Edge: <b>${edgeScore100}</b> ${edgeLevel.emoji} ${edgeLevel.labelVi}`);
  lines.push(`    🎯 Entry: <b>${entryScore}</b> ${entryLevel.emoji} ${entryLevel.labelVi}`);
  
  // ═══════════════════════════════════════════
  // GIÁ - Rõ ràng từng dòng
  // ═══════════════════════════════════════════
  lines.push(``);
  
  // Giá hiện tại
  if (signal.price && signal.price !== "-") {
    lines.push(`    💰 Giá hiện tại: <code>${formatPrice(signal.price)}</code>`);
  }
  
  // Trigger / Entry - QUAN TRỌNG
  if (signal.trigger && signal.trigger !== "-") {
    lines.push(`    📥 Trigger: <code>${formatPrice(signal.trigger)}</code>`);
  }
  if (signal.entry && signal.entry !== "-" && signal.entry !== signal.trigger) {
    lines.push(`    📥 Entry: <code>${formatPrice(signal.entry)}</code>`);
  }
  
  // Stop Loss - QUAN TRỌNG
  if (signal.stopLoss && signal.stopLoss !== "-") {
    lines.push(`    🛑 Stop Loss: <code>${formatPrice(signal.stopLoss)}</code>`);
  }
  
  // Take Profits - Từng mức riêng
  if (signal.takeProfits && signal.takeProfits.length > 0) {
    const validTPs = signal.takeProfits.filter(tp => tp && tp !== "-");
    if (validTPs.length >= 1) {
      lines.push(`    🎯 TP1: <code>${formatPrice(validTPs[0])}</code>`);
    }
    if (validTPs.length >= 2) {
      lines.push(`    🎯 TP2: <code>${formatPrice(validTPs[1])}</code>`);
    }
    if (validTPs.length >= 3) {
      lines.push(`    🎯 TP3: <code>${formatPrice(validTPs[2])}</code>`);
    }
  }
  
  // R:R
  if (signal.rr && signal.rr !== "-") {
    lines.push(`    📈 R:R: <code>${escapeHtml(signal.rr)}</code>`);
  }
  
  // ═══════════════════════════════════════════
  // MÔ TẢ - Đầy đủ
  // ═══════════════════════════════════════════
  lines.push(``);
  
  // Entry Type mô tả
  if (entryTypeInfo.full) {
    lines.push(`    📍 ${entryTypeInfo.full}`);
  }
  
  // Scenario mô tả
  const scenarioDesc = getScenarioDesc(signal.scenario);
  if (scenarioDesc) {
    lines.push(`    📋 ${scenarioDesc}`);
  }
  
  // Lý do / Notes
  if (signal.reason) {
    lines.push(`    💡 ${escapeHtml(signal.reason)}`);
  }
  
  return lines.join("\n");
};

// ════════════════════════════════════════════
// MAIN FORMATTER - TỔNG QUAN LÊN ĐẦU
// ════════════════════════════════════════════

export const formatTelegramMessage = (analysis: AnalysisResult): string => {
  const longSignals = analysis.signals?.filter(s => s.direction === "LONG") || [];
  const shortSignals = analysis.signals?.filter(s => s.direction === "SHORT") || [];
  const stayOutCount = analysis.signals?.filter(s => s.direction === "STAY_OUT").length || 0;
  const total = longSignals.length + shortSignals.length;
  
  const sortByScore = (a: TradingSignal, b: TradingSignal) => {
    const scoreA = a.entryScore ?? convertEdgeScoreTo100(a.edgeScore ?? 0);
    const scoreB = b.entryScore ?? convertEdgeScoreTo100(b.edgeScore ?? 0);
    return scoreB - scoreA;
  };
  longSignals.sort(sortByScore);
  shortSignals.sort(sortByScore);

  const lines: string[] = [];
  
  // ═══════════════════════════════════════════
  // TỔNG QUAN - LÊN ĐẦU ĐỂ POPUP TELE HIỂN THỊ
  // ═══════════════════════════════════════════
  
  lines.push(`📊 <b>TỔNG QUAN TÍN HIỆU</b>`);
  lines.push(``);
  lines.push(`🟢 LONG: <b>${longSignals.length}</b>  │  🔴 SHORT: <b>${shortSignals.length}</b>  │  Tổng: <b>${total}</b>`);
  
  // Top 3 coins điểm cao nhất
  if (total > 0) {
    const allSignals = [...longSignals, ...shortSignals].sort(sortByScore);
    const top3 = allSignals.slice(0, 3);
    const topStr = top3.map(s => {
      const dir = getDirectionStyle(s.direction);
      const score = s.entryScore ?? convertEdgeScoreTo100(s.edgeScore ?? 0);
      const level = getScoreLevel(score);
      return `${dir.color}<b>${s.symbol}</b>(<code>${score}</code>${level.emoji})`;
    }).join("  ");
    lines.push(`🏆 Top: ${topStr}`);
  }
  
  lines.push(``);
  
  // ═══════════════════════════════════════════
  // LONG SIGNALS
  // ═══════════════════════════════════════════
  
  if (longSignals.length > 0) {
    lines.push(`🟢🟢🟢 <b>LỆNH MUA (${longSignals.length})</b>`);
    longSignals.forEach((signal, idx) => {
      lines.push(formatSignalCard(signal, idx + 1));
    });
    lines.push(``);
  }
  
  // ═══════════════════════════════════════════
  // SHORT SIGNALS
  // ═══════════════════════════════════════════
  
  if (shortSignals.length > 0) {
    lines.push(`🔴🔴🔴 <b>LỆNH BÁN (${shortSignals.length})</b>`);
    shortSignals.forEach((signal, idx) => {
      lines.push(formatSignalCard(signal, idx + 1));
    });
    lines.push(``);
  }
  
  // ═══════════════════════════════════════════
  // KHÔNG CÓ TÍN HIỆU
  // ═══════════════════════════════════════════
  
  if (total === 0) {
    lines.push(`⚠️ <b>KHÔNG CÓ TÍN HIỆU</b>`);
    lines.push(`Thị trường đang sideway, chờ cơ hội tốt hơn.`);
    lines.push(``);
  }
  
  // ═══════════════════════════════════════════
  // FOOTER
  // ═══════════════════════════════════════════
  
  lines.push(`🔖 <code>${analysis.mailId?.substring(0, 12) || '-'}</code>  ⚠️ <i>Tự nghiên cứu trước khi giao dịch</i>`);
  
  return lines.join("\n");
};

// ════════════════════════════════════════════
// SHORT NOTIFICATION - Cho popup
// ════════════════════════════════════════════

export const formatShortNotification = (analysis: AnalysisResult): string => {
  const longSignals = analysis.signals?.filter(s => s.direction === "LONG") || [];
  const shortSignals = analysis.signals?.filter(s => s.direction === "SHORT") || [];
  const total = longSignals.length + shortSignals.length;
  
  if (total === 0) {
    return `📊 <b>Báo cáo mới</b>\n⚠️ Không có tín hiệu LONG/SHORT`;
  }
  
  const sortByScore = (a: TradingSignal, b: TradingSignal) => {
    const scoreA = a.entryScore ?? convertEdgeScoreTo100(a.edgeScore ?? 0);
    const scoreB = b.entryScore ?? convertEdgeScoreTo100(b.edgeScore ?? 0);
    return scoreB - scoreA;
  };
  
  const top3 = [...longSignals, ...shortSignals].sort(sortByScore).slice(0, 3);
  const topList = top3.map(s => {
    const score = s.entryScore ?? convertEdgeScoreTo100(s.edgeScore ?? 0);
    return `${getDirectionStyle(s.direction).color}${s.symbol}(${score}${getScoreEmoji(score)})`;
  }).join(" ");
  
  return `📊 <b>TÍN HIỆU MỚI</b> │ ${total} tín hiệu\n\n🟢 ${longSignals.length} LONG  │  🔴 ${shortSignals.length} SHORT\n\n🏆 ${topList}`;
};

// ════════════════════════════════════════════
// COMPACT SIGNAL
// ════════════════════════════════════════════

export const formatSignalCompact = (signal: TradingSignal): string => {
  const dir = getDirectionStyle(signal.direction);
  const edgeScore100 = convertEdgeScoreTo100(signal.edgeScore ?? 0);
  const entryScore = signal.entryScore ?? 0;
  const entryTypeInfo = getEntryTypeLabel(signal.entryType);
  
  // Lấy mức độ
  const edgeLevel = getScoreLevel(edgeScore100);
  const entryLevel = getScoreLevel(entryScore);
  
  const lines: string[] = [];
  lines.push(`${dir.color} <b>${signal.symbol}</b> ${dir.icon}${dir.label}${entryTypeInfo.short ? ` │ 📍${entryTypeInfo.short}` : ''}`);
  lines.push(`    📊 Edge: <code>${edgeScore100}</code>${edgeLevel.emoji}  🎯 Entry: <code>${entryScore}</code>${entryLevel.emoji}`);
  
  if (signal.price && signal.price !== "-") {
    lines.push(`    💰 Giá: <code>${formatPrice(signal.price)}</code>`);
  }
  
  return lines.join("\n");
};
