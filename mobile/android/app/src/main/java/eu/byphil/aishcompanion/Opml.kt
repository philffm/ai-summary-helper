package eu.byphil.aishcompanion

import org.w3c.dom.Element
import java.io.ByteArrayInputStream
import javax.xml.parsers.DocumentBuilderFactory

/** One feed of an OPML file: its address, name, and the folders it sits in (as tags). */
data class OpmlFeed(val url: String, val title: String, val tags: List<String>)

/**
 * OPML, the exchange format every feed reader understands: import a list from another app or the browser extension, export yours.
 * Folders become tags and tags become folders (a feed with several tags appears in each). Pure JVM, so it is unit-tested.
 */
object Opml {
    private const val MAX_BYTES = 2_000_000

    /** Feeds with a usable web address, in file order, duplicates merged (their tags joined). Empty when the text is not OPML. Never throws. */
    fun parse(text: String): List<OpmlFeed> = runCatching {
        if (text.length > MAX_BYTES || text.contains("<!ENTITY", ignoreCase = true) || text.contains("<!DOCTYPE", ignoreCase = true)) return@runCatching emptyList<OpmlFeed>()   // no external entities, no entity bombs
        val factory = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = false; isExpandEntityReferences = false }
        val doc = factory.newDocumentBuilder().parse(ByteArrayInputStream(text.trimStart('﻿').toByteArray(Charsets.UTF_8)))
        val body = doc.documentElement.getElementsByTagName("body").item(0) as? Element ?: return@runCatching emptyList<OpmlFeed>()
        val order = ArrayList<String>()
        val byUrl = HashMap<String, Pair<String, LinkedHashSet<String>>>()
        fun walk(parent: Element, folders: List<String>) {
            var node = parent.firstChild
            while (node != null) {
                val el = node as? Element
                if (el != null && el.tagName.equals("outline", ignoreCase = true)) {
                    val xml = el.getAttribute("xmlUrl").ifBlank { el.getAttribute("xmlurl") }
                    val name = el.getAttribute("title").ifBlank { el.getAttribute("text") }.trim()
                    if (xml.isNotBlank()) {
                        val url = FeedSync.cleanFeedUrl(xml)
                        if (url.isNotEmpty() && order.size < FeedSync.MAX_FEEDS) {
                            val entry = byUrl.getOrPut(url) { order.add(url); name to LinkedHashSet() }
                            entry.second.addAll(folders)
                        }
                    }
                    walk(el, if (xml.isBlank() && name.isNotEmpty()) folders + name else folders)
                }
                node = node.nextSibling
            }
        }
        walk(body, emptyList())
        order.map { u -> val (n, t) = byUrl.getValue(u); OpmlFeed(u, n, FeedSync.cleanTags(t.toList())) }
    }.getOrDefault(emptyList())

    /** The feeds as OPML 2.0: untagged feeds at the top, the others inside a folder per tag. */
    fun export(feeds: List<Feed>): String {
        fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&apos;")
        fun line(f: Feed, indent: String) = "$indent<outline type=\"rss\" text=\"${esc(f.name)}\" title=\"${esc(f.name)}\" xmlUrl=\"${esc(f.url)}\"/>\n"
        val sb = StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<opml version=\"2.0\">\n  <head><title>AI Summary Helper feeds</title></head>\n  <body>\n")
        feeds.filter { it.tags.isEmpty() }.forEach { sb.append(line(it, "    ")) }
        feeds.flatMap { it.tags }.distinct().sorted().forEach { tag ->
            sb.append("    <outline text=\"${esc(tag)}\" title=\"${esc(tag)}\">\n")
            feeds.filter { tag in it.tags }.forEach { sb.append(line(it, "      ")) }
            sb.append("    </outline>\n")
        }
        return sb.append("  </body>\n</opml>\n").toString()
    }
}
