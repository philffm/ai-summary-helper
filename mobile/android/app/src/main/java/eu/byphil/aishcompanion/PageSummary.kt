package eu.byphil.aishcompanion

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

/** A web page reduced to its readable text: the title and blocks of (tag, text). */
data class Page(val title: String, val blocks: List<Pair<String, String>>, val lang: String = "") {
    fun text(): String = blocks.joinToString("\n") { (tag, t) -> if (tag.startsWith("h")) "\n$t" else t }.trim()
}

object PageExtract {
    /**
     * Run in the page with evaluateJavascript. Picks the article (or main, or the body) and collects headings, paragraphs,
     * list items, quotes and code blocks, leaving out navigation, footers, forms and other page furniture. Nothing leaves the phone.
     */
    const val SCRIPT = """(function(){
var DROP='script,style,noscript,nav,header,footer,aside,form,iframe,svg,button,select,dialog,[role=navigation],[role=banner],[role=complementary],[aria-hidden=true],.advert,.ads,.cookie,.cookies,#comments,.comments';
function weight(el){var n=0,ps=el.querySelectorAll('p');for(var i=0;i<ps.length;i++){var t=ps[i].textContent||'';if(t.length>60)n+=t.length}return n}
var root=null,best=0,c=document.querySelectorAll('article,main,[role=main]');
for(var i=0;i<c.length;i++){var w=weight(c[i]);if(w>best){best=w;root=c[i]}}
if(!root||best<300)root=document.body;
var out=[],seen={},els=root.querySelectorAll('h1,h2,h3,p,li,blockquote,pre');
for(var j=0;j<els.length&&out.length<1500;j++){var e=els[j];
if(e.closest(DROP))continue;
if(e.tagName==='BLOCKQUOTE'&&e.querySelector('p'))continue;
if(e.tagName==='LI'&&e.querySelector('p'))continue;
var t=(e.textContent||'').replace(/\s+/g,' ').trim();
var tag=e.tagName.toLowerCase();
if(tag==='blockquote')tag='q';
var min=tag[0]==='h'?2:(tag==='li'?25:40);
if(t.length<min||seen[t])continue;seen[t]=1;out.push([tag,t])}
return JSON.stringify({title:document.title||'',lang:document.documentElement.lang||'',blocks:out})})()"""

    /** The value evaluateJavascript hands back is the script's string result, JSON-quoted again. Null when it is empty or unusable. */
    fun parse(raw: String?): Page? {
        if (raw.isNullOrBlank() || raw == "null") return null
        return try {
            val inner = JSONTokener(raw).nextValue() as? String ?: return null
            val o = JSONObject(inner)
            val arr: JSONArray = o.optJSONArray("blocks") ?: return null
            val blocks = (0 until arr.length()).mapNotNull {
                val b = arr.optJSONArray(it) ?: return@mapNotNull null
                val t = b.optString(1).trim()
                if (t.isEmpty()) null else b.optString(0) to t
            }
            if (blocks.isEmpty()) null else Page(o.optString("title"), blocks, o.optString("lang"))
        } catch (_: Exception) { null }
    }
}

object PageSummary {
    const val CHUNK = 6000          // characters per model call (~1500 tokens) so small context windows are enough
    const val MAX_CHUNKS = 5        // longer pages are cut here; the start of an article carries the point
    const val MIN_TEXT = 200

    fun system(lang: String) = "You summarise a web page for a reader who is short of time. " + SummaryLangs.rule(lang) + " " +
        "Start with one sentence saying what the page is about, then give 3 to 5 short key points, one per line, each starting with '- '. " +
        "Use only what the text says: no opinions, no added facts, no preamble, no markdown other than the leading '- '. Keep it under 150 words."
    /** Notes on one part of a long page stay in the page's language; the final summary is written in the chosen one. */
    const val SYSTEM_PART = "Condense this part of a longer web page into its key facts, as at most 5 short lines starting with '- '. " +
        "Use only what the text says. Keep the language of the text."
    fun systemJoin(lang: String) = "These are notes from consecutive parts of one web page. Write the summary of the whole page: one sentence on what it is about, " +
        "then 3 to 5 key points, one per line, each starting with '- '. Use only the notes; no preamble. Keep it under 150 words. " + SummaryLangs.rule(lang, "the notes")

    const val SYSTEM_PASSAGES = "From the text, copy the 3 to 5 sentences that carry its main points. Copy each one word for word, exactly as written in the text, " +
        "one per line, with no numbering, no quotation marks and no comment."
    const val MAX_PASSAGES = 5

    /** Stable per link, so summarizing the same page again replaces its reading-list entry. Only characters ArticleStore accepts. */
    fun localId(url: String): String {
        val d = java.security.MessageDigest.getInstance("SHA-256").digest(url.trim().toByteArray())
        return "local-" + d.take(8).joinToString("") { "%02x".format(it) }
    }

    /** The article as the reading list stores it (wire format v2 plus local=true), with the summary and the extracted text. */
    fun articleJson(url: String, page: Page, summary: String, now: Long, passages: List<String> = emptyList()): String {
        val blocks = JSONArray(); page.blocks.forEach { (t, x) -> blocks.put(JSONArray().put(t).put(x)) }
        val host = runCatching { java.net.URI(url).host }.getOrNull().orEmpty().removePrefix("www.")
        return JSONObject().put("v", 2).put("url", url).put("sentAt", now).put("title", page.title.ifBlank { host.ifBlank { url } })
            .put("site", host).put("byline", "").put("lang", page.lang).put("summary", summary).put("blocks", blocks).put("local", true).also { o ->
                if (passages.isNotEmpty()) o.put("hl", JSONArray().also { hl -> passages.forEach { hl.put(JSONArray().put("g").put(it)) } })   // "g" = ghost (AI) highlight, as the extension sends them
            }.toString()
    }

    /** What goes to WhatsApp, mail and the like: title, the summary, and the link. */
    fun shareText(title: String, summary: String, url: String): String =
        listOf(title.trim(), summary.trim(), url.trim()).filter { it.isNotEmpty() }.joinToString("\n\n")

    fun enough(page: Page): Boolean = page.text().length >= MIN_TEXT

    /** The page text cut into model-sized parts (at sentence ends), at most [MAX_CHUNKS]. */
    fun parts(page: Page): List<String> {
        val body = (if (page.title.isNotBlank()) page.title + "\n\n" else "") + page.text()
        return BriefingPrompt.chunks(body, CHUNK).take(MAX_CHUNKS)
    }

    /** Keeps the "- " points but drops other markdown the reader would see as stray characters. */
    fun clean(reply: String): String? {
        val t = reply.replace(Regex("(?m)^[ \\t]*[*•]\\s+"), "- ")
            .replace(Regex("(?m)^[ \\t]*#{1,6}\\s+"), "")
            .replace(Regex("[*_`]+"), "")
            .replace(Regex("[ \\t]+"), " ")
            .replace(Regex("\\n{3,}"), "\n\n")
            .trim()
        return if (t.length >= 20) t else null
    }

    private val SPACES = Regex("\\s+")
    private val LEAD = Regex("^[\\s\\-*•\\d.)\"“”'‘’]+|[\"“”'‘’\\s]+$")

    /** The lines the model returned that really are in the page text (inside one block, whitespace aside): cleaned, 20 to 400 characters, no repeats, at most [MAX_PASSAGES]. */
    fun validPassages(reply: String?, page: Page): List<String> {
        if (reply.isNullOrBlank()) return emptyList()
        val blocks = page.blocks.filter { it.first != "pre" }.map { it.second.replace(SPACES, " ") }
        val out = ArrayList<String>()
        for (line in reply.lines()) {
            val t = line.replace(LEAD, "").replace(SPACES, " ").trim()
            if (t.length < 20 || t.length > 400 || out.any { it.equals(t, ignoreCase = true) }) continue
            if (blocks.none { it.contains(t) }) continue
            out.add(t)
            if (out.size >= MAX_PASSAGES) break
        }
        return out
    }

    /** Asks the model for the key sentences of the page and keeps those it copied correctly. Blocking; empty when the model is missing or copied nothing right. */
    fun passages(context: Context, page: Page): List<String> {
        val parts = parts(page).take(2)
        if (parts.isEmpty()) return emptyList()
        val found = ArrayList<String>()
        LocalLlm.session(context) { ask ->
            for (p in parts) validPassages(ask(SYSTEM_PASSAGES, p), page).forEach { if (found.size < MAX_PASSAGES && found.none { f -> f == it }) found.add(it) }
        }
        return found
    }

    /** Blocking; call off the main thread. [progress] gets (step, steps). Null when the model is missing or gave nothing usable. */
    fun summarize(context: Context, page: Page, progress: (Int, Int) -> Unit = { _, _ -> }): String? {
        val parts = parts(page)
        if (parts.isEmpty()) return null
        val lang = Store(context).summaryLang
        var result: String? = null
        LocalLlm.session(context) { ask ->
            if (parts.size == 1) {
                progress(1, 1)
                result = ask(system(lang), parts[0])
            } else {
                val total = parts.size + 1
                val notes = parts.mapIndexedNotNull { i, p -> progress(i + 1, total); ask(SYSTEM_PART, p)?.let(::clean) }
                if (notes.isNotEmpty()) { progress(total, total); result = ask(systemJoin(lang), notes.joinToString("\n\n")) }
            }
        }
        return result?.let(::clean)
    }
}
