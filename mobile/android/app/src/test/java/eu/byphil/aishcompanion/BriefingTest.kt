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
        assertEquals("A", got.first())
        assertEquals(setOf("A", "B", "D"), got.toSet())   // C: third of feed 1; E read; F older than 36 hours
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

    @Test fun goodNewsOnlyDropsHeavyStories() {
        assertTrue(GoodNews.heavy("Explosion kills five in the city"))
        assertTrue(GoodNews.heavy("Krieg: Angriff auf die Stadt"))
        assertTrue(GoodNews.heavy("Man dies after crash"))
        assertTrue(!GoodNews.heavy("Warm weather brings the first warning of spring"))
        assertTrue(!GoodNews.heavy("Wildflowers return to the valley"))
        assertTrue(!GoodNews.heavy("Today a school opens its new library"))
        val list = listOf(entry(1, "a", "Bomb attack on market", 1), entry(1, "b", "Library opens its doors", 2), entry(2, "c", "Flood warning issued", 3, summary = "Rivers rise across the region."))
        assertEquals(listOf("Library opens its doors"), BriefingBuilder.pick(list, now, mode = NewsMode.GOOD).map { it.title })   // nothing rated positive: falls back to nothing heavy
        assertEquals(listOf("Library opens its doors"), BriefingBuilder.pick(list, now, mode = NewsMode.NO_BAD).map { it.title })
        assertEquals(3, BriefingBuilder.pick(list, now).size)
        val none = Briefing(emptyList(), 0, now, mode = NewsMode.GOOD)
        assertEquals("Good morning. No good news in your feeds this morning.", none.spokenParts(8)[0])
    }

    @Test fun extraIsSpokenAfterTheNewsAndSurvivesJson() {
        val b = Briefing(listOf(BriefingItem("S", "Title", "", "")), 0, now, extra = "Honey never spoils. Jars were found in tombs.")
        val parts = b.spokenParts(8)
        assertEquals("Honey never spoils. Jars were found in tombs.", parts.last())
        assertEquals(b, Briefing.fromJson(b.toJson()))
        val n = b.copy(narration = "A long enough narration that the voice reads out loud today.")
        assertEquals(listOf("A long enough narration that the voice reads out loud today.", "Honey never spoils. Jars were found in tombs."), n.spokenParts(8))
    }

    @Test fun cloudExtraBodyAndReply() {
        val body = org.json.JSONObject(CloudExtra.body("", java.time.LocalDate.of(2026, 10, 12), "German"))
        val msgs = body.getJSONArray("messages")
        assertTrue(msgs.getJSONObject(0).getString("content").contains("2026-10-12"))
        assertTrue(msgs.getJSONObject(0).getString("content").contains("German"))
        assertEquals(CloudExtra.DEFAULT_PROMPT, msgs.getJSONObject(1).getString("content"))
        assertEquals("Octopuses have three hearts and blue blood.", CloudExtra.parse("""{"choices":[{"message":{"role":"assistant","content":"**Octopuses** have three hearts and blue blood."}}]}"""))
        assertNull(CloudExtra.parse("{}")); assertNull(CloudExtra.parse("""{"choices":[{"message":{"content":"ok"}}]}"""))
        assertNull(CloudExtra.fetch("", ""))
    }

    @Test fun moodRatingsDriveGoodNewsOnly() {
        fun rated(e: FeedEntryRef, v: Double) = e.copy(stored = e.stored.copy(sent = v))
        val list = listOf(
            rated(entry(1, "a", "Quiet day at the harbour", 1), -0.8),      // rated heavy: out, though no heavy word
            entry(2, "b", "Neutral item", 2),                               // not rated: stays
            rated(entry(3, "c", "Village wins prize", 3), 0.7),             // rated positive: first
        )
        assertEquals(listOf("Village wins prize"), BriefingBuilder.pick(list, now, mode = NewsMode.GOOD).map { it.title })
        assertEquals(setOf("Village wins prize", "Neutral item"), BriefingBuilder.pick(list, now, mode = NewsMode.NO_BAD).map { it.title }.toSet())
        assertEquals(3, BriefingBuilder.pick(list, now).size)
        assertEquals("pos", Mood.of(0.15)); assertEquals("neg", Mood.of(-0.15)); assertEquals("neu", Mood.of(0.14)); assertNull(Mood.of(null))
        assertEquals("neg", Mood.effective(entry(1, "x", "Bomb attack", 1)))   // unrated: the word list decides
    }

    @Test fun readsTheModelsScoreLine() {
        assertEquals(listOf(0.6, -0.4, 0.0), MoodPrompt.parse("1:3 | 2:-2 | 3:0", 3))
        assertEquals(listOf(0.5, null, -1.0), MoodPrompt.parse("1: 0.5\n3 = -9", 3))   // decimals are -1..1 already; whole numbers clamp
        assertEquals(listOf<Double?>(null, null), MoodPrompt.parse("no scores here", 2))
        assertEquals(listOf<Double?>(0.2), MoodPrompt.parse("1:1 | 7:5", 1))   // out-of-range ids ignored
        val u = MoodPrompt.user(listOf(FeedItem("1", "Hello\n world", "", 0, "", "A fine sentence about hello. More.", "")))
        assertTrue(u.startsWith("Items:\n1. Hello world - A fine sentence about hello."))
    }

    @Test fun onlyRecentUnratedItemsAreRated() {
        val list = listOf(entry(1, "a", "New", 1), entry(1, "b", "Old", 24 * 9), entry(2, "c", "Done", 2).let { it.copy(stored = it.stored.copy(sent = 0.1)) })
        assertEquals(listOf("New"), MoodRater.candidates(list, now).map { it.stored.item.title })
        assertEquals(MoodRater.MAX_PER_RUN, MoodRater.candidates((1..100).map { entry(it, "i$it", "T$it", 1) }, now).size)
    }

    @Test fun wholeHistoryHasNoAgeOrCountLimit() {
        val list = (1..150).map { entry(it, "i$it", "T$it", 24L * 30) } + listOf(entry(200, "r", "Rated", 24L * 30).let { it.copy(stored = it.stored.copy(sent = 0.3)) })
        assertEquals(0, MoodRater.candidates(list, now).size)             // all older than 7 days
        assertEquals(150, MoodRater.candidates(list, now, all = true).size)   // no cap, rated ones skipped
    }

    @Test fun newsModeSurvivesJsonAndOldFlagMapsToGood() {
        val b = Briefing(listOf(BriefingItem("S", "T", "", "")), 0, now, mode = NewsMode.NO_BAD)
        assertEquals(NewsMode.NO_BAD, Briefing.fromJson(b.toJson())!!.mode)
        assertEquals(NewsMode.GOOD, Briefing.fromJson("""{"items":[],"readingUnread":0,"builtAt":1,"g":true}""")!!.mode)
        assertEquals(NewsMode.ALL, NewsMode.of("nonsense"))
    }
}
