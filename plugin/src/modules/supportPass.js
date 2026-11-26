// modules/supportPass.js — the Support Pass card in Settings › Account & Plan (AISH-037 A).
// Signed in and free: monthly / yearly buttons open the API's checkout link, which redirects to the payment provider with the
// account's email filled in and the account id attached, so the webhook switches exactly this account on, whatever email is
// typed at checkout. After paying,
// Stripe redirects to the thank-you page, where the extension claims the payment (bg/checkoutClaim.js). Signed in and active:
// a short “active” line. Signed out: hidden (the sign-in form above says it all). Built from existing classes only.
import { T } from './feedI18n.js';
import { storeBuild } from './storeBuild.js';

// Buying goes through the API, which redirects to the current payment provider (byphilapi src/routes/billing.js):
// a provider switch is a server change, no extension release.
export const CHECKOUT_BASE = 'https://api.byphil.eu/v1/billing/checkout';
export const PLANS = ['monthly', 'yearly'];
const PB_ID = /^[a-z0-9]{15}$/;

/** Checkout link for a plan with the account id and email attached (each only when it looks right). */
export function checkoutUrl(plan, user) {
    if (!PLANS.includes(plan)) return null;
    const u = new URL(CHECKOUT_BASE);
    u.searchParams.set('plan', plan);
    if (user && PB_ID.test(String(user.id || ''))) u.searchParams.set('account', user.id);
    const email = user && typeof user.email === 'string' ? user.email.trim() : '';
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) u.searchParams.set('email', email);
    return u.toString();
}

export const isPassActive = (user) => !!user && user.subscription_status === 'active';

/** Draw the card into #supportPassGroup. user = the stored account record, or null when signed out. */
export function renderSupportPass(doc, user, { open = (url) => window.open(url, '_blank', 'noopener') } = {}) {
    const box = doc.getElementById('supportPassGroup');
    if (!box) return;
    box.textContent = '';
    // the App Store build says nothing about buying: only a pass that is already running is shown
    if (!user || (storeBuild() && !isPassActive(user))) { box.hidden = true; return; }
    box.hidden = false;
    const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const head = el('div', 'flex-label-row');
    head.append(el('label', 'type-badge', T('⭐ Support Pass')));
    const badge = el('span', 'status-badge', isPassActive(user) ? T('Active') : T('Free'));
    badge.classList.toggle('signed-in', isPassActive(user));
    head.append(badge);
    box.append(head);
    if (isPassActive(user)) {
        box.append(el('p', 'input-caption', storeBuild() ? T('Thank you for keeping AISH independent.') : T('Thank you for keeping AISH independent. Change card, switch plan or cancel from the link in your Stripe receipt.')));
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
    box.append(el('p', 'input-caption', T('Checkout opens with your email filled in. After paying, the pass switches on by itself; no order number needed.')));
    // A license key is optional now: older Pro keys and gift codes. The field opens below the card.
    const keyLink = el('a', null, T('Have a license key or gift code?'));
    keyLink.href = '#licenseKey';
    keyLink.id = 'openLicenseKey';
    keyLink.addEventListener('click', (e) => {
        e.preventDefault();
        const g = doc.getElementById('legacyLicenseGroup');
        if (!g) return;
        g.dataset.open = '1';
        g.style.display = 'block';
        const k = doc.getElementById('licenseKey');
        if (k) k.focus();
    });
    const p = el('p', 'input-caption');
    p.append(keyLink);
    box.append(p);
}
