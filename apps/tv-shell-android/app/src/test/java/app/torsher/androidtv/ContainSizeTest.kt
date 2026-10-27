package app.torsher.androidtv

import org.junit.Assert.assertEquals
import org.junit.Test

class ContainSizeTest {
    @Test
    fun widerVideoGetsBarsAboveAndBelow() {
        assertEquals(1920 to 803, containSize(1920f, 803f, 1920, 1080))
    }

    @Test
    fun narrowerVideoGetsBarsOnTheSides() {
        assertEquals(1440 to 1080, containSize(1440f, 1080f, 1920, 1080))
    }

    @Test
    fun anamorphicVideoUsesPixelAspect() {
        // DVD 720×576 с пикселем 16:11 — кадр 16:9
        assertEquals(1920 to 1080, containSize(720f * 64f / 45f, 576f, 1920, 1080))
    }
}
