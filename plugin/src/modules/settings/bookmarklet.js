// settings/bookmarklet.js — split out of settingsManager.js (R4 phase 1).
import { SK } from '../storageKeys.js';
import StorageManager from '../storageManager.js';
import { escapeHtml } from '../textUtils.js';
import { T } from '../feedI18n.js';

// ── Section: Bookmarklet Generator ───────────────────────────────────
// Generates a self-contained bookmarklet that embeds the user's byphil
// Cloud token. Bookmarklets run in the page context and cannot access
// chrome.storage, so the token must be baked into the JS string at
// generation time.
export function initBookmarkletGenerator() {
    const generateBtn = document.getElementById('generateBookmarkletBtn');
    const resultContainer = document.getElementById('bookmarkletResultContainer');
    const dragLink = document.getElementById('bookmarkletDragLink');

    if (!generateBtn || !resultContainer || !dragLink) return;

    generateBtn.addEventListener('click', async () => {
        const data = await StorageManager.getAll();
        const token = data[SK.token];

        if (!token) {
            alert(T('⚠️ You must be logged into byphil Cloud first to generate a bookmarklet.'));
            return;
        }

        // Minified payload with the token injected. The token is embedded
        // directly so the bookmarklet can authenticate without storage access.
        const js = (str) => JSON.stringify(String(str)).replace(/</g, '\\u003c');
        const rawJs = `
            (async function(){
                const t='${token}';
                const d=document;
                const ui=d.createElement('div');
                ui.style.cssText='position:fixed;top:20px;right:20px;width:350px;max-height:80vh;overflow-y:auto;background:#fff;color:#171717;z-index:999999;padding:16px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,0.2);font-family:sans-serif;font-size:14px;line-height:1.5;';
                ui.innerHTML='<b>✨ AI Summary Helper</b><br><span id="as-st">'+${js(escapeHtml(T('Reading page...')))}+'</span><br><button id="as-cl" style="margin-top:10px;padding:4px 8px;border:none;background:#eee;border-radius:4px;cursor:pointer;">'+${js(escapeHtml(T('Close')))}+'</button>';
                d.body.appendChild(ui);
                d.getElementById('as-cl').onclick=()=>ui.remove();
                try{
                    const text=d.body.innerText.substring(0,15000);
                    d.getElementById('as-st').innerText=${js(T('Summarizing...'))};
                    const r=await fetch('https://api.byphil.eu/v1/projects/ai_summary_helper/chat',{
                        method:'POST',
                        headers:{'Content-Type':'application/json','Authorization':'Bearer '+t},
                        body:JSON.stringify({
                            model:'google/gemini-3.8-flash',
                            messages:[
                                {role:'system',content:'You are a summarizer returning concise, useful summaries.'},
                                {role:'user',content:'- brief summary\\n- key takeaways\\n\\nContent: '+text}
                            ]
                        })
                    });
                    if(!r.ok) throw new Error(r.status===401?${js(T('Session expired. Generate a new bookmarklet.'))}:${js(T('API Error:'))}+' '+r.status);
                    const j=await r.json();
                    const s=j.result?.choices?.[0]?.message?.content||j.choices?.[0]?.message?.content||j.summary||${js(T('No summary returned.'))};
                    const html=String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\\*\\*(.*?)\\*\\*/g,'<b>$1</b>').replace(/\\n/g,'<br>');
                    d.getElementById('as-st').innerHTML='<div style="margin-top:8px;padding-top:8px;border-top:1px solid #eee;">'+html+'</div>';
                }catch(e){
                    d.getElementById('as-st').innerText='❌ '+${js(T('Error:'))}+' '+e.message;
                }
            })();
        `;

        // Build the final bookmarklet URL (URL-encoded so special chars don't break it)
        const bookmarkletUrl = 'javascript:' + encodeURIComponent(rawJs.replace(/\s+/g, ' ').trim());

        dragLink.href = bookmarkletUrl;
        resultContainer.style.display = 'block';
    });
}

