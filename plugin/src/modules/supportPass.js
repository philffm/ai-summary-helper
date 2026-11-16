// modules/supportPass.js — the Support Pass card in Settings › Account & Plan (AISH-037 A).
// Signed in and free: monthly / yearly buttons open the Stripe Payment Link with the account's email filled in and the account id
// as client_reference_id, so the webhook switches exactly this account on, whatever email is typed at Stripe. After paying,
// Stripe redirects to the thank-you page, where the extension claims the payment (bg/checkoutClaim.js). Signed in and active:
// a short “active” line. Signed out: hidden (the sign-in form above says it all). Built from existing classes only.
import { T } from './feedI18n.js';

export const PASS_LINKS = {
    monthly: 'https://buy.stripe.com/8x24gy3Lj9RkeAl9T5bEA02',
    yearly: 'https://buy.stripe.com/7sY3cu4Pnd3wak5d5hbEA03',
};
const PB_ID = /^[a-z0-9]{15}$/;

/** Payment Link for a plan with the account's email and id attached (each only when it looks right). */
export function checkoutUrl(plan, user) {
    const base = PASS_LINKS[plan];
    if (!base) return null;
    const u = new URL(base);
    const email = user && typeof user.email === 'string' ? user.email.trim() : '';
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) u.searchParams.set('prefilled_email', email);
    if (user && PB_ID.test(String(user.id || ''))) u.searchParams.set('client_reference_id', user.id);
    return u.toString();
}

export const isPassActive = (user) => !!user && user.subscription_status === 'active';

/** Draw the card into #supportPassGroup. user = the stored account record, or null when signed out. */
export function renderSupportPass(doc, user, { open = (url) => window.open(url, '_blank', 'noopener') } = {}) {
    const box = doc.getElementById('supportPassGroup');
    if (!box) return;
    box.textContent = '';
    if (!user) { box.hidden = true; return; }
    box.hidden = false;
    const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const head = el('div', 'flex-label-row');
    head.append(el('label', 'type-badge', T('⭐ Support Pass')));
    const badge = el('span', 'status-badge', isPassActive(user) ? T('Active') : T('Free'));
    badge.classList.toggle('signed-in', isPassActive(user));
    head.append(badge);
    box.append(head);
    if (isPassActive(user)) {
        box.append(el('p', 'input-caption', T('Thank you for keeping AISH independent. Change card, switch plan or cancel from the link in your Stripe receipt.')));
        return;
    }
    box.append(el('p', 'input-caption', T('More cloud models, no daily cap, Kindle delivery. Keeps AISH independent.')));
    const row = el('div', 'account-actions');
    for (const [plan, label, cls] of [['monthly', T('€4.99 a month'), 'button-primary'], ['yearly', T('€29.94 a year'), 'button-secondary']]) {
        const b = el('button', cls, label);
        b.type = 'button';
        b.dataset.plan = plan;
        b.addEventListener('click', () => { const url = checkoutUrl(plan, user); if (url) open(url); });
        row.append(b);
    }
    box.append(row);
    box.append(el('p', 'input-caption', T('Stripe opens with your email filled in. After paying, the pass switches on by itself; no order number needed.')));
}
