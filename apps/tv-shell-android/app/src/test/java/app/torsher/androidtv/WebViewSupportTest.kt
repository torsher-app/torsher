package app.torsher.androidtv

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WebViewSupportTest {
    @Test
    fun outdatedBelowChromium68() {
        assertTrue(isWebViewOutdated("66.0.3359.158"))
        assertFalse(isWebViewOutdated("68.0.3440.91"))
        assertFalse(isWebViewOutdated("142.0.7444.0"))
    }

    @Test
    fun unknownVersionIsNotOutdated() {
        assertFalse(isWebViewOutdated(null))
        assertFalse(isWebViewOutdated("dev"))
    }
}
