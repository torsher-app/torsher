package app.torsher.androidtv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

// Те же случаи, что у обёртки webOS (apps/tv-shell-webos/src/server.test.ts)
class ServerAddressTest {
    @Test
    fun normalizesAddresses() {
        mapOf(
            "192.168.1.10:8080" to "http://192.168.1.10:8080",
            "  192.168.1.10:8080/  " to "http://192.168.1.10:8080",
            "http://torsher.local" to "http://torsher.local",
            "HTTPS://media.example/torsher//" to "https://media.example/torsher",
            "http://192.168.1.10:8080/?x=1#/home" to "http://192.168.1.10:8080",
            "http://192.168.1.10:80" to "http://192.168.1.10",
            "10.0.2.2:5173" to "http://10.0.2.2:5173",
        ).forEach { (input, expected) -> assertEquals(input, expected, normalizeAddress(input)) }
    }

    @Test
    fun rejectsInvalidAddresses() {
        listOf("", "   ", "ftp://192.168.1.10", "http://", "192.168.1.10:99999", "not an address")
            .forEach { assertNull(it, normalizeAddress(it)) }
    }

    @Test
    fun hidesHttpButKeepsHttps() {
        assertEquals("192.168.1.10:8080", displayAddress("http://192.168.1.10:8080"))
        assertEquals("https://media.example", displayAddress("https://media.example"))
    }

    @Test
    fun buildsServerUrls() {
        assertEquals("http://192.168.1.10:8080/api/health", healthUrl("http://192.168.1.10:8080"))
        assertEquals("https://media.example/torsher/?platform=tv", showcaseUrl("https://media.example/torsher"))
    }

    @Test
    fun originDropsPathQueryAndHash() {
        assertEquals("https://media.example", originOf("https://media.example/torsher"))
        assertEquals("http://10.0.2.2:5173", originOf("http://10.0.2.2:5173/?platform=tv#/title/1"))
    }
}
