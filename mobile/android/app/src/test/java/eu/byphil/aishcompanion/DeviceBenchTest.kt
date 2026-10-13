package eu.byphil.aishcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceBenchTest {
    @Test fun bigFastPhoneGetsTheBestModel() {
        assertEquals("gemma-4-e4b", DeviceBench.recommend(DeviceProfile(12.0, 8, 40.0)).id)
    }

    @Test fun eightGigabytePhoneGetsE2b() {
        assertEquals("gemma-4-e2b", DeviceBench.recommend(DeviceProfile(8.0, 8, 30.0)).id)
    }

    @Test fun smallPhoneGetsTheTinyModel() {
        assertEquals("qwen3-0.6b", DeviceBench.recommend(DeviceProfile(4.0, 8, 20.0)).id)
    }

    @Test fun nothingFitsFallsBackToTheSmallest() {
        assertEquals("qwen3-0.6b", DeviceBench.recommend(DeviceProfile(2.0, 4, 3.0)).id)
    }

    @Test fun tooLittleMemoryIsTooBig() {
        assertEquals(Fit.NO, DeviceBench.verdict(DeviceProfile(6.0, 8, 40.0), Models.byId("gemma-4-e4b")).fit)
    }

    @Test fun unknownIdFallsBackToDefault() {
        assertEquals(Models.DEFAULT, Models.byId("nope"))
    }

    @Test fun thinkingIsRemoved() {
        assertEquals("Hello", LocalLlm.clean("<think>hmm</think>Hello"))
        assertEquals("", LocalLlm.clean("<think>still thinking"))
        assertTrue(Models.ALL.all { it.url.startsWith("https://huggingface.co/") && it.sha256.length == 64 })
    }
}
