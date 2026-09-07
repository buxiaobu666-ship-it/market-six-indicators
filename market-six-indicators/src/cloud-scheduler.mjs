// All times are Beijing time, independent of the server's local timezone.
export function clockAt(now) {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return { day: shifted.toISOString().slice(0, 10), minute: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
}

export function nextAction(now, state, collecting = false) {
  const { day, minute } = clockAt(now);
  if (state.day !== day) return 'reset';
  if (state.delivery) return 'idle';
  // A restart may catch up within 15 minutes, but never sends yesterday's data.
  if (minute >= 480 && minute < 495) return 'deliver';
  if (minute < 470 || minute >= 480 || collecting) return 'idle';
  const age = now.getTime() - (state.lastAttempt || 0);
  // Prepare at 07:50, then refresh at 07:57. Failures retry once a minute.
  if (!state.lastAttempt || (!state.candidate && age >= 60000) ||
      (minute >= 477 && state.lastAttempt < Date.parse(`${day}T07:57:00+08:00`))) return 'collect';
  return 'idle';
}

export function deliveryText(now, state) {
  const { day } = clockAt(now);
  const candidate = state.candidate;
  if (state.day === day && candidate && candidate.day === day &&
      candidate.checkedAt <= now.getTime() && now.getTime() - candidate.checkedAt <= 10 * 60000) {
    return { kind: 'report', text: candidate.text };
  }
  return { kind: 'failure', text: `【市场六指标日报未发送】${day} 08:00（北京时间）\n六项数据未能全部通过本次校验，本次停止日报发送。\n原因：${state.error || '云端未在发送前完成有效取数。'}\n没有使用旧日报、估算值或缺项内容。`.slice(0, 3900) };
}
