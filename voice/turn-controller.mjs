// 独立通话调度；音频、识别、模型和播放由适配器提供。
export function createTurnController({ transcribe, respond, speak, onEvent = () => {} }) {
  let generation = 0, active = null, closed = false;
  const emit = (type, extra = {}) => onEvent({ type, ...extra });
  const cancel = () => {
    generation++;
    if (active) { active.abort(); active = null; emit('interrupted'); }
  };
  async function submit(audio, context = {}) {
    if (closed) throw Error('通话已结束');
    cancel();
    const id = generation, controller = new AbortController();
    active = controller;
    const current = () => !closed && id === generation && !controller.signal.aborted;
    try {
      emit('transcribing');
      const text = String(await transcribe(audio, { signal: controller.signal }) || '').trim();
      if (!current()) return { interrupted: true };
      if (!text) { emit('silence'); return { empty: true }; }
      emit('heard', { text });
      const reply = String(await respond(text, { signal: controller.signal, context }) || '').trim();
      if (!current()) return { interrupted: true };
      if (!reply) { emit('silence'); return { text, empty: true }; }
      emit('speaking', { text: reply });
      await speak(reply, { signal: controller.signal });
      if (!current()) return { interrupted: true };
      emit('idle');
      return { text, reply };
    } catch (error) {
      if (!current() || error?.name === 'AbortError') return { interrupted: true };
      emit('error', { message: String(error?.message || error) });
      throw error;
    } finally {
      if (id === generation) active = null;
    }
  }
  return { submit, interrupt: cancel, close() { closed = true; cancel(); emit('closed'); } };
}
