/**
 * TELEGRAM FORMATTER - High-tech Professional Design
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

const getDirectionStyle = (direction: string): { icon: string; label: string; color: string } => {
  switch (direction) {
    case "LONG": return { icon: "▲", label: "LONG", color: "🟢" };
    case "SHORT": return { icon: "▼", label: "SHORT", color: "🔴" };
    case "STAY_OUT": return { icon: "◆", label: "WAIT", color: "⚪" };
    default: return { icon: "●", label: direction, color: "⚫" };
  }
};

const getScoreEmoji = (score: number): string => {
  if (score >= 90) return "🔥";
  if (score >= 80) return "⚡";
  if (score >= 70) return "✨";
  if (score >= 55) return "👍";
  if (score >= 40) return "📊";
  return "⬇️";
};

const getEntryTypeLabel = (entryType: string | undefined): { short: string; full: string } => {
  switch (entryType) {
    case "stop_breakout": return { short: "BREAKOUT", full: "Vào khi phá vỡ mức kháng cự/hỗ trợ" };
    case "limit_pullback": return { short: "LIMIT", full: "Đặt lệnh chờ khi giá hồi về" };
    case "market_now": return { short: "MARKET", full: "Vào lệnh ngay tại giá hiện tại" };
    default: return { short: "—", full: "" };
  }
};

const getScenarioDesc = (scenario: string | undefined): string => {
  switch (scenario) {
    case "A": return "Setup hoàn hảo - Tất cả điều kiện đều thuận lợi";
    case "B": return "Breakout rõ ràng - Phá vỡ mức quan trọng với volume";
    case "C": return "Compression - Giá nén chặt, chuẩn bị bùng nổ";
    case "D": return "Cần xác nhận - Chờ thêm tín hiệu để vào lệnh";
    case "F1": return "Pullback về vùng hỗ trợ - Cơ hội mua tốt";
    case "F2": return "Pullback về MA - Test đường trung bình động";
    case "F3": return "Pullback về Fibonacci - Hồi về mức Fibo quan trọng";
    case "G": return "Rủi ro cao - Cần quản lý vốn chặt chẽ";
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
// FORMAT SIGNAL CARD
// ════════════════════════════════════════════

const formatSignalCard = (signal: TradingSignal): string => {
  const dir = getDirectionStyle(signal.direction);
  const entryTypeInfo = getEntryTypeLabel(signal.entryType);
  
  // 2 điểm
  const edgeScore7 = signal.edgeScore ?? 0;
  const edgeScore100 = convertEdgeScoreTo100(edgeScore7);
  const entryScore = signal.entryScore ?? 0;
  
  const lines: string[] = [];
  
  // HEADER với Entry Type
  lines.push(``);
  lines.push(`┌─────────────────────────────────┐`);
  lines.push(`│ ${dir.color} <b>${escapeHtml(signal.symbol)}</b>  ${dir.icon} <b>${dir.label}</b>  │  📍 <b>${entryTypeInfo.short}</b>`);
  lines.push(`│ ⏱ ${signal.timeframe || "4h"}  │  ${signal.scenario ? `📋 Scenario ${signal.scenario}` : ''}`);
  lines.push(`└─────────────────────────────────┘`);
  
  // 2 SCORES CHUNG 1 HÀNG
  lines.push(``);
  lines.push(`  📊 Edge <b>${edgeScore100}</b>${getScoreEmoji(edgeScore100)}  │  🎯 Entry <b>${entryScore}</b>${getScoreEmoji(entryScore)}`);
  
  // PRICE INFO
  lines.push(``);
  if (signal.price && signal.price !== "-") {
    lines.push(`  💰 Price     <code>${formatPrice(signal.price)}</code>`);
  }
  
  const entryPrice = signal.trigger || signal.entry;
  if (entryPrice && entryPrice !== "-") {
    lines.push(`  📥 Entry     <code>${formatPrice(entryPrice)}</code>`);
  }
  
  if (signal.stopLoss && signal.stopLoss !== "-") {
    lines.push(`  🛑 SL        <code>${formatPrice(signal.stopLoss)}</code>`);
  }
  
  if (signal.takeProfits && signal.takeProfits.length > 0) {
    const validTPs = signal.takeProfits.filter(tp => tp && tp !== "-").slice(0, 3);
    if (validTPs.length > 0) {
      lines.push(`  🎯 TP        <code>${validTPs.map(tp => formatPrice(tp)).join("</code> → <code>")}</code>`);
    }
  }
  
  if (signal.rr && signal.rr !== "-") {
    lines.push(`  📈 R:R       <code>${escapeHtml(signal.rr)}</code>`);
  }
  
  // MÔ TẢ CHI TIẾT
  lines.push(``);
  lines.push(`  ─────────────────────────────`);
  
  // Entry Type description
  if (entryTypeInfo.full) {
    lines.push(`  📍 <i>${entryTypeInfo.full}</i>`);
  }
  
  // Scenario description
  const scenarioDesc = getScenarioDesc(signal.scenario);
  if (scenarioDesc) {
    lines.push(`  📋 <i>${scenarioDesc}</i>`);
  }
  
  // Original reason
  if (signal.reason) {
    lines.push(`  💡 <i>${escapeHtml(signal.reason.substring(0, 80))}${signal.reason.length > 80 ? '...' : ''}</i>`);
  }
  
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
  
  const sortByScore = (a: TradingSignal, b: TradingSignal) => {
    const scoreA = a.entryScore ?? convertEdgeScoreTo100(a.edgeScore ?? 0);
    const scoreB = b.entryScore ?? convertEdgeScoreTo100(b.edgeScore ?? 0);
    return scoreB - scoreA;
  };
  longSignals.sort(sortByScore);
  shortSignals.sort(sortByScore);

  const lines: string[] = [];
  
  // HEADER
  const now = new Date().toLocaleString('vi-VN', { 
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit'
  });
  
  lines.push(`╔═══════════════════════════════════╗`);
  lines.push(`║   📊 <b>TRADING SIGNALS</b>             ║`);
  lines.push(`║   ⏰ ${now}                  ║`);
  lines.push(`╚═══════════════════════════════════╝`);
  lines.push(``);
  
  // STATS
  lines.push(`<b>📈 OVERVIEW</b>`);
  lines.push(`   Total: <b>${total}</b> signals`);
  lines.push(`   🟢 LONG <b>${longSignals.length}</b>  │  🔴 SHORT <b>${shortSignals.length}</b>${stayOutCount > 0 ? `  │  ⚪ WAIT <b>${stayOutCount}</b>` : ''}`);
  
  if (total > 0) {
    const allSignals = [...longSignals, ...shortSignals].sort(sortByScore);
    const top3 = allSignals.slice(0, 3);
    const topStr = top3.map(s => {
      const dir = getDirectionStyle(s.direction);
      const score = s.entryScore ?? convertEdgeScoreTo100(s.edgeScore ?? 0);
      return `${dir.color}${s.symbol}(<code>${score}</code>)`;
    }).join("  ");
    lines.push(`   🏆 ${topStr}`);
  }
  lines.push(``);
  
  // Summary
  if (analysis.summary) {
    lines.push(`<b>📌 MARKET</b>`);
    lines.push(`   <i>${escapeHtml(analysis.summary.substring(0, 100))}${analysis.summary.length > 100 ? '...' : ''}</i>`);
    lines.push(``);
  }
  
  // LONG SIGNALS
  if (longSignals.length > 0) {
    lines.push(`🟢 <b>LONG POSITIONS</b> (${longSignals.length})`);
    lines.push(`═══════════════════════════════════`);
    longSignals.forEach(signal => {
      lines.push(formatSignalCard(signal));
    });
    lines.push(``);
  }
  
  // SHORT SIGNALS
  if (shortSignals.length > 0) {
    lines.push(`🔴 <b>SHORT POSITIONS</b> (${shortSignals.length})`);
    lines.push(`═══════════════════════════════════`);
    shortSignals.forEach(signal => {
      lines.push(formatSignalCard(signal));
    });
    lines.push(``);
  }
  
  // No signals
  if (total === 0) {
    lines.push(`┌─────────────────────────────────┐`);
    lines.push(`│  ⚠️ <b>NO SIGNALS</b>                  │`);
    lines.push(`│  Market sideways / No setup     │`);
    lines.push(`└─────────────────────────────────┘`);
    lines.push(``);
  }
  
  // FOOTER
  lines.push(`───────────────────────────────────`);
  lines.push(`🔖 <code>${analysis.mailId?.substring(0, 12) || '-'}</code>  ⚠️ <i>DYOR - Not financial advice</i>`);
  
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
    return `📊 <b>New Report</b>\n⚠️ No LONG/SHORT signals`;
  }
  
  const sortByScore = (a: TradingSignal, b: TradingSignal) => {
    const scoreA = a.entryScore ?? convertEdgeScoreTo100(a.edgeScore ?? 0);
    const scoreB = b.entryScore ?? convertEdgeScoreTo100(b.edgeScore ?? 0);
    return scoreB - scoreA;
  };
  
  const top3 = [...longSignals, ...shortSignals].sort(sortByScore).slice(0, 3);
  const topList = top3.map(s => `${getDirectionStyle(s.direction).color}${s.symbol}`).join(" ");
  
  return `📊 <b>NEW SIGNALS</b> │ ${total} total\n\n🟢 ${longSignals.length} LONG  │  🔴 ${shortSignals.length} SHORT\n\n🏆 ${topList}`;
};

// ════════════════════════════════════════════
// COMPACT SIGNAL
// ════════════════════════════════════════════

export const formatSignalCompact = (signal: TradingSignal): string => {
  const dir = getDirectionStyle(signal.direction);
  const edgeScore100 = convertEdgeScoreTo100(signal.edgeScore ?? 0);
  const entryScore = signal.entryScore ?? 0;
  const entryTypeInfo = getEntryTypeLabel(signal.entryType);
  
  const lines: string[] = [];
  lines.push(`${dir.color} <b>${signal.symbol}</b> ${dir.icon}${dir.label} │ 📍${entryTypeInfo.short}`);
  lines.push(`   📊 Edge <code>${edgeScore100}</code>  🎯 Entry <code>${entryScore}</code>`);
  
  if (signal.price && signal.price !== "-") {
    lines.push(`   💰 <code>${formatPrice(signal.price)}</code>`);
  }
  
  return lines.join("\n");
};
