package eu.byphil.aishcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AccountTest {
    private val base = "aish-inbox://v1?i=" + "a".repeat(22) + "&k=" + "b".repeat(43) + "&w=" + "c".repeat(43)

    @Test fun pairingCarriesTheLicenseKeyWhenValid() {
        val p = Pairing.parse("$base&lk=AISH-TEST-4f9c2a7e1b")!!
        assertEquals("AISH-TEST-4f9c2a7e1b", p.license)
        assertEquals(p, Pairing.parse(p.toCode()))
        assertNull(Pairing.parse(base)!!.license)
        assertNull(Pairing.parse("$base&lk=bad%20key")!!.license)   // ignored, the code still works
        assertNotNull(Pairing.parse("$base&lk=short"))
        assertNull(Pairing.parse("$base&lk=short")!!.license)
        assertFalse(Pairing.parse(base)!!.toCode().contains("lk="))
    }

    @Test fun readsTheUsageAnswer() {
        val pro = Account.parse("""{"success":true,"quota":{"used_usd":0.123,"limit_usd":1.5,"percent":8,"requests":4,"reset_at":"x"},"account":{}}""")!!
        assertTrue(pro.active); assertEquals(8, pro.percent)
        assertEquals("Pro active · 92% of this month's AI allowance left", Account.describe(pro))
        val free = Account.parse("""{"success":true,"quota":null}""")!!
        assertFalse(free.active)
        assertEquals("This key is not recognised, or has no AI allowance.", Account.describe(free))
        assertNull(Account.parse("not json"))
        assertEquals("Could not check the license right now.", Account.describe(null))
        assertNull(Account.check(""))
    }

    @Test fun readsTokensAndModels() {
        val u = Account.parse("""{"quota":{"used_usd":0.5,"limit_usd":1.5,"percent":33,"requests":7,"tokens_in":12300,"tokens_out":950,"reset_at":"2026-11-01T00:00:00.000Z",
            "by_model":[{"model":"google/gemini-2.5-flash","requests":5,"cost_usd":0.4,"tokens_in":10000,"tokens_out":800},{"model":"b/small","requests":2,"cost_usd":0.1,"tokens_in":2300,"tokens_out":150}]},
            "account":{"last_model":"google/gemini-2.5-flash"}}""")!!
        assertEquals(7, u.requests); assertEquals(12300L, u.tokensIn); assertEquals(2, u.models.size)
        assertEquals("google/gemini-2.5-flash", u.models[0].model); assertEquals(0.4, u.models[0].costUsd, 1e-9)
        assertEquals("google/gemini-2.5-flash", u.lastModel)
        assertEquals("12.3k", Account.tokens(12300)); assertEquals("950", Account.tokens(950)); assertEquals("2.4M", Account.tokens(2_400_000))
        assertEquals(0, Account.parse("""{"quota":{"used_usd":0,"limit_usd":1.5,"percent":0},"account":{}}""")!!.models.size)
    }
}
