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
        assertEquals("Pro active · 0.12 of 1.50 used this month (8%)", Account.describe(pro))
        val free = Account.parse("""{"success":true,"quota":null}""")!!
        assertFalse(free.active)
        assertEquals("This key is not recognised, or has no AI allowance.", Account.describe(free))
        assertNull(Account.parse("not json"))
        assertEquals("Could not check the license right now.", Account.describe(null))
        assertNull(Account.check(""))
    }
}
