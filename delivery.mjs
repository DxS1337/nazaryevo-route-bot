// Keep photos separate from text. Always remove the temporary status, even on failure.
export async function withStatus(api, chat, text, task, replyMarkup) {
  const message = await api('sendMessage', { chat_id: chat, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
  let removed = false;
  const remove = async () => {
    if (removed) return;
    removed = true;
    try { await api('deleteMessage', { chat_id: chat, message_id: message.message_id }); } catch {}
  };
  try { return await task(remove); } finally { await remove(); }
}
export async function sendPhoto(api, chat, png, name = 'card.png') {
  const form = new FormData();
  form.set('chat_id', String(chat));
  form.set('photo', new Blob([png], { type: 'image/png' }), name);
  return api('sendPhoto', form);
}
