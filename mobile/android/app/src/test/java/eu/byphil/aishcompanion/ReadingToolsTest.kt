package eu.byphil.aishcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReadingToolsTest {
    private fun art(summary: String = "A short summary.", hl: List<Highlight> = emptyList()) = Article(
        id = "a1", url = "https://x.test/post", title = "Cars: \"free\" Sundays", site = "x.test", byline = "Jo Doe", lang = "en", summary = summary,
        blocks = listOf(Block("h2", "Why"), Block("p", "The city closes streets."), Block("li", "Fewer cars"), Block("q", "Walk more"), Block("pre", "a = 1")),
        sentAt = 1_760_000_000_000, truncated = true, highlights = hl,
    )

    @Test fun markdownHasFrontMatterSummaryAndBlocks() {
        val md = ArticleMarkdown.render(art(hl = listOf(Highlight(false, "The city closes streets."), Highlight(true, "Walk more"))))
        assertTrue(md.startsWith("---\ntitle: \"Cars: \\\"free\\\" Sundays\"\nsource: \"https://x.test/post\"\nauthor: \"Jo Doe\"\nsite: \"x.test\"\ncreated: 2025-10-09\ntags: []\n---\n"))
        assertTrue(md.contains("# Cars: \"free\" Sundays\n"))
        assertTrue(md.contains("## Summary\n\nA short summary."))
        assertTrue(md.contains("## Highlights\n\n> The city closes streets."))
        assertTrue(md.contains("## AI highlights\n\n> Walk more"))
        assertTrue(md.contains("## Why\n\nThe city closes streets.\n\n- Fewer cars\n> Walk more\n\n```\na = 1\n```"))
        assertTrue(md.contains("shortened"))
        assertTrue(md.endsWith("\n") && !md.endsWith("\n\n"))
    }

    @Test fun markdownWithoutText() {
        val md = ArticleMarkdown.render(art(), includeText = false)
        assertFalse(md.contains("Original text"))
    }

    @Test fun fileNamesAreSafe() {
        assertEquals("Cars Free Sundays.md", ArticleMarkdown.fileName("Cars: /Free\\ Sundays?"))
        assertEquals("Untitled.md", ArticleMarkdown.fileName("  ///  "))
    }

    private val list = listOf(
        ArticleMeta("1", "Über Brücken", "spiegel.de", "https://spiegel.de/1", 3, 4),
        ArticleMeta("2", "Cars in the city", "x.test", "https://x.test/2", 2, 4),
        ArticleMeta("3", "Bees", "nature.com", "https://nature.com/3", 1, 4),
    )

    @Test fun searchMatchesTitleSiteAndText() {
        val read = setOf("2"); val archived = setOf("3")
        fun go(q: String, v: ReadingView = ReadingView.ALL) = ReadingFilter.apply(list, q, v, { it in read }, { it in archived }) { if (it == "2") "pollen and honey in spring" else "" }.map { it.id }
        assertEquals(listOf("1", "2"), go(""))                 // archived hidden in All
        assertEquals(listOf("1"), go("uber"))                  // accents folded
        assertEquals(listOf("2"), go("x.test"))                // site
        assertEquals(listOf("2"), go("honey spring"))          // text, every word
        assertEquals(emptyList<String>(), go("honey zebra"))
        assertEquals(listOf("1"), go("", ReadingView.UNREAD))
        assertEquals(listOf("3"), go("", ReadingView.ARCHIVED))
    }

    @Test fun rsvpWordsAndTiming() {
        val w = Rsvp.words(listOf(Block("p", "One  two,\nthree."), Block("pre", "skip me"), Block("h1", "Four")))
        assertEquals(listOf("One", "two,", "three.", "Four"), w)
        assertEquals(200L, Rsvp.delayMs("word", 300))
        assertEquals(300L, Rsvp.delayMs("word,", 300))
        assertEquals(400L, Rsvp.delayMs("word.", 300))
        assertTrue(Rsvp.delayMs("extraordinarily", 300) > 200)
        assertEquals(2, Rsvp.minutesLeft(450, 300))
    }

    @Test fun rsvpPivot() {
        assertEquals(0, Rsvp.pivot("a"))
        assertEquals(1, Rsvp.pivot("word"))
        assertEquals(2, Rsvp.pivot("\"word"))   // skips the opening quote
    }

    @Test fun settingsBackupKeepsOnlyPreferences() {
        val all = mapOf<String, Any>("pairing" to "aish-inbox://secret", "license" to "k", "alarm.on" to true, "alarm.hour" to 7, "alarm.sound" to "content://x", "summary.lang" to "de", "reader.scale" to 1.2f, "use.local.2026-10" to 4)
        val text = SettingsBackup.export(all, now = 1)
        assertFalse(text.contains("secret")); assertFalse(text.contains("license")); assertFalse(text.contains("content://"))
        val back = SettingsBackup.parse(text)
        assertEquals(setOf("alarm.on", "alarm.hour", "summary.lang", "reader.scale"), back.keys)
        assertEquals(true, back["alarm.on"]); assertEquals(7, back["alarm.hour"]); assertEquals("de", back["summary.lang"])
    }

    @Test fun settingsBackupRejectsForeignFilesAndIgnoresUnknownKeys() {
        var failed = false
        try { SettingsBackup.parse("{\"format\":\"other\",\"values\":{}}") } catch (e: IllegalArgumentException) { failed = true }
        assertTrue(failed)
        val ok = SettingsBackup.parse("{\"format\":\"aish-settings-v1\",\"values\":{\"pairing\":\"x\",\"ui.left\":true}}")
        assertEquals(mapOf<String, Any>("ui.left" to true), ok)
    }

    @Test fun readAloudUnitsAreSentencesWithoutCode() {
        val u = ReadAloudUnits.article("Title", listOf(Block("p", "One. Two!"), Block("pre", "code()"), Block("li", "Three")))
        assertEquals(listOf("Title", "One.", "Two!", "Three"), u)
        assertEquals(listOf("A.", "B."), ReadAloudUnits.summary("A. B."))
    }

    @Test fun reminderOptionsDependOnTheTimeOfDay() {
        val zone = java.time.ZoneId.of("Europe/Berlin")
        val morning = java.time.ZonedDateTime.of(2026, 10, 13, 9, 30, 0, 0, zone)
        val o1 = ReminderTimes.options(morning)
        assertEquals(listOf("In 1 hour", "This evening, 18:00", "Tomorrow morning, 08:00"), o1.map { it.label })
        assertEquals(java.time.Duration.ofMinutes(8 * 60 + 30).toMillis(), o1[1].delayMs)
        assertEquals(java.time.Duration.ofHours(22).plusMinutes(30).toMillis(), o1[2].delayMs)
        val night = java.time.ZonedDateTime.of(2026, 10, 13, 20, 0, 0, 0, zone)
        assertEquals(listOf("In 1 hour", "Tomorrow morning, 08:00"), ReminderTimes.options(night).map { it.label })
    }
}
