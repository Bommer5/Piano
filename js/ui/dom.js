// Petits utilitaires DOM : création d'éléments, toasts, boîtes de dialogue.

/** h('div', {class:'x', onclick: fn}, [enfants]) */
export function h(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'value') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

let toastBox;
export function toast(text, ms = 2800) {
  if (!toastBox) {
    toastBox = h('div', { class: 'toasts', 'aria-live': 'polite' });
    document.body.appendChild(toastBox);
  }
  const t = h('div', { class: 'toast' }, text);
  toastBox.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 400);
  }, ms);
}

/**
 * Boîte de dialogue. buttons: [{label, primary?, action?}]
 * @returns {HTMLDialogElement}
 */
export function modal(title, html, buttons = [{ label: 'OK', primary: true }]) {
  const dlg = h('dialog', { class: 'modal' });
  const body = h('div', { class: 'modal-body', html });
  const actions = h('div', { class: 'modal-actions' }, buttons.map((b) =>
    h('button', { class: 'btn' + (b.primary ? ' primary' : ''), onclick: () => { dlg.close(); b.action?.(); } }, b.label)));
  dlg.append(h('h2', {}, title), body, actions);
  dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 300));
  document.body.appendChild(dlg);
  if (dlg.showModal) dlg.showModal();
  else dlg.setAttribute('open', '');
  return dlg;
}

export function download(filename, data, mime = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

export function stars(n, max = 3) {
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, max - n));
}
