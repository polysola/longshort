/**
 * TELEGRAM FORMATTER - High-tech Minimalist Design
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

const getScoreBar = (score: number): string => {
  const filled = Math.round(score / 10);
  const empty = 10 - filled;
  return "█".repeat(filled) + "░".repeat(empty);
};

const getScoreLabel = (score: number): { label: string; icon: string } => {
  if (score >= 90) return { label: "XUẤT SẮC", icon: "🔥" };
  if (score >= 80) return { label: "RẤT TỐT", icon: "⚡" };
  if (score >= 70) return { label: "TỐT", icon: "✨" };
  if (score >= 55) return { label: "KHÁ", icon: "👍" };
  if (score >= 40) return { label: "TB", icon: "📊" };
  return { label: "YẾU", icon: "⬇️" };
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

// Tạo mô tả chi tiết
const generateDescription = (signal: TradingSignal): string => {
  const parts: string[] = [];
  
  const scenarioDesc: { [key: string]: string } = {
    "A": "Perfect setup, strong trend",
    "B": "Good setup, clear breakout", 
    "C": "Compression pattern",
    "D": "Need confirmation",
    "F1": "Pullback to support",
    "F2": "Pullback to MA",
    "F3": "Pullback to Fibo",
    "G": "High risk setup"
  };
  
  const entryDesc: { [key: string]: string } = {
    "stop_breakout": "Enter on breakout",
    "limit_pullback": "Wait for pullback",
    "market_now": "Enter at market"
  };
  
  if (signal.scenario) {
    const desc = scenarioDesc[signal.scenario];
    if (desc) parts.push(desc);
  }
  if (signal.entryType) {
    const desc = entryDesc[signal.entryType];
    if (desc) parts.push(desc);
  }
  if (signal.reason) {
    parts.push(signal.reason);
  }
  
  return parts.join(" • ") || "No description";
};

// ════════════════════════════════════════════
// FORMAT SIGNAL CARD - High-tech Design
// ════════════════════════════════════════════

const formatSignalCard = (signal: TradingSignal, index: number): string => {
  const dir = getDirectionStyle(signal.direction);
  
  const edgeScore7 = signal.edgeScore ?? 0;
  const edgeScore100 = convertEdgeScoreTo100(edgeScore7);
  const entryScore = signal.entryScore ?? edgeScore100;
  const mainScore = Math.max(edgeScore100, entryScore);
  const scoreInfo = getScoreLabel(mainScore);
  
  const lines: string[] = [];
  
  // ═══════════════════════════════════════
  // HEADER
  // ═══════════════════════════════════════
  lines.push(``);
  lines.push(`┌─────────────────────────────┐`);
  lines.push(`│ ${dir.color} <b>${escapeHtml(signal.symbol)}</b>  ${dir.icon} <b>${dir.label}</b>  ⏱${signal.timeframe || "4h"}`);
  lines.push(`└─────────────────────────────┘`);
  
  // Score bar
  lines.push(`  ${scoreInfo.icon} <code>${getScoreBar(mainScore)}</code> <b>${mainScore}</b>/100`);
  lines.push(`     ${scoreInfo.label}`);
  lines.push(``);
  
  // Price info - compact
  if (signal.price && signal.price !== "-") {
    lines.push(`  💰 Price   <code>${formatPrice(signal.price)}</code>`);
  }
  
  const entryPrice = signal.trigger || signal.entry;
  if (entryPrice && entryPrice !== "-") {
    lines.push(`  📥 Entry   <code>${formatPrice(entryPrice)}</code>`);
  }
  
  if (signal.stopLoss && signal.stopLoss !== "-") {
    lines.push(`  🛑 SL      <code>${formatPrice(signal.stopLoss)}</code>`);
  }
  
  if (signal.takeProfits && signal.takeProfits.length > 0) {
    const validTPs = signal.takeProfits.filter(tp => tp && tp !== "-").slice(0, 3);
    if (validTPs.length > 0) {
      const tpStr = validTPs.map(tp => `<code>${formatPrice(tp)}</code>`).join(" → ");
      lines.push(`  🎯 TP      ${tpStr}`);
    }
  }
  
  if (signal.rr && signal.rr !== "-") {
    lines.push(`  📈 R:R     ${escapeHtml(signal.rr)}`);
  }
  
  // Description
  lines.push(``);
  const desc = generateDescription(signal);
  lines.push(`  💡 <i>${escapeHtml(desc.substring(0, 45))}${desc.length > 45 ? '...' : ''}</i>`);
  
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
    month: '2-digit'
  });
  
  lines.push(`╔═══════════════════════════════╗`);
  lines.push(`║   📊 <b>TRADING SIGNALS</b>         ║`);
  lines.push(`║   ⏰ ${now}              ║`);
  lines.push(`╚═══════════════════════════════╝`);
  lines.push(``);
  
  // ═══════════════════════════════════════
  // STATS
  // ═══════════════════════════════════════
  lines.push(`<b>📈 OVERVIEW</b>`);
  lines.push(`   Total: <b>${total}</b> signals`);
  lines.push(`   🟢 LONG <b>${longSignals.length}</b>  │  🔴 SHORT <b>${shortSignals.length}</b>${stayOutCount > 0 ? `  │  ⚪ WAIT <b>${stayOutCount}</b>` : ''}`);
  
  if (total > 0) {
    const allSignals = [...longSignals, ...shortSignals].sort(sortByScore);
    const top3 = allSignals.slice(0, 3);
    const topStr = top3.map((s, i) => {
      const dir = getDirectionStyle(s.direction);
      const score = Math.max(convertEdgeScoreTo100(s.edgeScore ?? 0), s.entryScore ?? 0);
      return `${dir.color}${s.symbol}(<b>${score}</b>)`;
    }).join("  ");
    lines.push(`   🏆 ${topStr}`);
  }
  lines.push(``);
  
  // Summary
  if (analysis.summary) {
    lines.push(`<b>📌 MARKET</b>`);
    lines.push(`   <i>${escapeHtml(analysis.summary.substring(0, 80))}${analysis.summary.length > 80 ? '...' : ''}</i>`);
    lines.push(``);
  }
  
  // ═══════════════════════════════════════
  // LONG SIGNALS
  // ═══════════════════════════════════════
  if (longSignals.length > 0) {
    lines.push(`🟢 <b>LONG POSITIONS</b> (${longSignals.length})`);
    lines.push(`═══════════════════════════════`);
    longSignals.forEach((signal, index) => {
      lines.push(formatSignalCard(signal, index + 1));
    });
    lines.push(``);
  }
  
  // ═══════════════════════════════════════
  // SHORT SIGNALS
  // ═══════════════════════════════════════
  if (shortSignals.length > 0) {
    lines.push(`🔴 <b>SHORT POSITIONS</b> (${shortSignals.length})`);
    lines.push(`═══════════════════════════════`);
    shortSignals.forEach((signal, index) => {
      lines.push(formatSignalCard(signal, index + 1));
    });
    lines.push(``);
  }
  
  // No signals
  if (total === 0) {
    lines.push(`┌─────────────────────────────┐`);
    lines.push(`│  ⚠️ <b>NO SIGNALS</b>              │`);
    lines.push(`│  Market is sideways or      │`);
    lines.push(`│  no good setup available.   │`);
    lines.push(`└─────────────────────────────┘`);
    lines.push(``);
  }
  
  // ═══════════════════════════════════════
  // FOOTER
  // ═══════════════════════════════════════
  lines.push(`───────────────────────────────`);
  lines.push(`🔖 <code>${analysis.mailId?.substring(0, 12) || '-'}</code>  ⚠️ <i>DYOR</i>`);
  
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
    const scoreA = Math.max(convertEdgeScoreTo100(a.edgeScore ?? 0), a.entryScore ?? 0);
    const scoreB = Math.max(convertEdgeScoreTo100(b.edgeScore ?? 0), b.entryScore ?? 0);
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
  const score = Math.max(convertEdgeScoreTo100(signal.edgeScore ?? 0), signal.entryScore ?? 0);
  const scoreInfo = getScoreLabel(score);
  
  const lines: string[] = [];
  lines.push(`${dir.color} <b>${signal.symbol}</b> ${dir.icon}${dir.label}`);
  lines.push(`   ${scoreInfo.icon} <code>${getScoreBar(score)}</code> ${score}`);
  
  if (signal.price && signal.price !== "-") {
    lines.push(`   💰 <code>${formatPrice(signal.price)}</code>`);
  }
  
  const entry = signal.trigger || signal.entry;
  if (entry && entry !== "-") {
    lines.push(`   📥 <code>${formatPrice(entry)}</code>`);
  }
  
  return lines.join("\n");
};
