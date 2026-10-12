package eu.byphil.aishcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

class BriefingTest {
    private val now = 1_800_000_000_000L
    private val h = 3600_000L
    private fun feed(n: Int) = Feed("https://f$n.example/feed", "Feed $n")
    private fun entry(f: Int, id: String, title: String, ageH: Long, read: Boolean = false, summary: String = "") =
        FeedEntryRef(feed(f), StoredItem(FeedItem(id, title, "https://f$f.example/$id", now - ageH * h, "", summary, ""), read))

    @Test fun picksFreshUnreadNewestFirstWithPerFeedCap() {
        val list = listOf(
            entry(1, "a", "A", 1), entry(1, "b", "B", 2), entry(1, "c", "C", 3),
            entry(2, "d", "D", 4), entry(2, "e", "E", 5, read = true), entry(3, "f", "F", 40),
        )
        val got = BriefingBuilder.pick(list, now).map { it.title }
        assertEquals(listOf("A", "B", "D"), got)   // C: third of feed 1; E read; F older than 36 hours
    }

    @Test fun fallsBackToTheLastWeekAndSkipsUndatedItems() {
        val list = listOf(entry(1, "a", "Old", 50), entry(2, "b", "Undated", 0).let { it.copy(stored = it.stored.copy(item = it.stored.item.copy(published = 0))) })
        assertEquals(listOf("Old"), BriefingBuilder.pick(list, now).map { it.title })
        assertTrue(BriefingBuilder.pick(listOf(entry(1, "a", "Ancient", 24 * 10)), now).isEmpty())
    }

    @Test fun limitsToSevenStories() {
        val list = (1..20).map { entry(it, "i$it", "T$it", it.toLong()) }
        assertEquals(7, BriefingBuilder.pick(list, now).size)
    }

    @Test fun snippetIsTheFirstSentenceAndSkipsTitleRepeats() {
        fun item(title: String, summary: String) = FeedItem("1", title, "", now, "", summary, "")
        assertEquals("The council approved the new budget on Monday evening.", BriefingBuilder.snippet(item("Budget", "The council approved the new budget on Monday evening. More follows.")))
        assertEquals("", BriefingBuilder.snippet(item("Council approves the budget", "Council approves the budget")))
        assertEquals("", BriefingBuilder.snippet(item("x", "Short.")))
        assertTrue(BriefingBuilder.snippet(item("x", "word ".repeat(100))).length <= BriefingBuilder.SNIPPET_MAX + 1)
    }

    @Test fun spokenTextAndJsonRoundTrip() {
        val b = BriefingBuilder.build(listOf(entry(1, "a", "Big news?", 1, summary = "Something quite interesting happened today. Details later.")), 2, now)
        val parts = b.spokenParts(7)
        assertEquals("Good morning. One new story from your feeds.", parts[0])
        assertEquals("1. Feed 1: Big news? Something quite interesting happened today.", parts[1])
        assertEquals("You also have 2 unread articles in your reading list.", parts[2])
        assertEquals(listOf("Nothing new in your feeds."), Briefing(emptyList(), 0, now).spokenParts(20).map { it.removePrefix("Good evening. ") })
        assertEquals(b, Briefing.fromJson(b.toJson()))
        assertNull(Briefing.fromJson("not json")); assertNull(Briefing.fromJson(null))
    }

    @Test fun nextAlarmFindsTheRightDay() {
        val zone = ZoneId.of("Europe/Berlin")
        fun at(d: Int, hh: Int, mm: Int) = ZonedDateTime.of(2026, 10, d, hh, mm, 0, 0, zone).toInstant().toEpochMilli()
        val all = 0b1111111
        assertEquals(at(13, 7, 0), AlarmTime.next(at(12, 17, 40), zone, 7, 0, all))   // Monday evening → Tuesday morning
        assertEquals(at(12, 7, 0), AlarmTime.next(at(12, 5, 0), zone, 7, 0, all))
        assertEquals(at(13, 7, 0), AlarmTime.next(at(12, 7, 0), zone, 7, 0, all))     // exactly now → tomorrow
        assertEquals(at(17, 8, 30), AlarmTime.next(at(12, 17, 40), zone, 8, 30, 0b1100000))   // Saturday and Sunday only
        assertEquals(at(19, 7, 0), AlarmTime.next(at(12, 17, 40), zone, 7, 0, 0b0000001))     // Mondays only → next Monday
        assertNull(AlarmTime.next(at(12, 17, 40), zone, 7, 0, 0))
        assertNotNull(AlarmTime.next(at(12, 17, 40), zone, 7, 0, 0b0000001))
    }

    @Test fun promptAndReplyCleaning() {
        val items = listOf(BriefingItem("Feed 1", "Big news", "Something happened today.", "https://x"))
        val u = BriefingPrompt.user(items, 1, 7)
        assertTrue(u.contains("Time of day: morning"))
        assertTrue(u.contains("1. [Feed 1] Big news - Something happened today."))
        assertTrue(u.contains("1 unread article is waiting"))
        assertTrue(!BriefingPrompt.user(items, 0, 20).contains("waiting in the reading list"))
        assertEquals("Good morning. Big news today.\n\nMore later in the day.", BriefingPrompt.cleanReply("## Good morning. **Big** news today.\n\n\n\n- More later in the day.   "))
        assertNull(BriefingPrompt.cleanReply("Short."))
        assertNull(BriefingPrompt.cleanReply("x".repeat(BriefingPrompt.MAX_REPLY + 1)))
        val chunks = BriefingPrompt.chunks("One sentence here. ".repeat(60))
        assertTrue(chunks.all { it.length <= 400 } && chunks.size > 1)
        val b = Briefing(items, 0, now, "Hello there. A story.")
        assertEquals(listOf("Hello there. A story."), b.spokenParts(7))
        assertEquals(b, Briefing.fromJson(b.toJson()))
    }
}
