package app.torsher.androidtv

import java.io.IOException
import java.net.SocketTimeoutException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

class ServerCheckTest {
    private val base = "http://192.168.1.10:8080"

    private fun check(request: HealthRequest) = runBlocking { checkServer(base, request) }

    @Test
    fun okOnHealthyTorsher() {
        var asked: String? = null
        val result = check { url, _ ->
            asked = url
            200 to """{"status":"ok"}"""
        }

        assertEquals(CheckResult.Ok, result)
        assertEquals("http://192.168.1.10:8080/api/health", asked)
    }

    @Test
    fun notTorsherOnForeignResponse() {
        assertEquals(CheckResult.NotTorsher, check { _, _ -> 404 to "{}" })
        assertEquals(CheckResult.NotTorsher, check { _, _ -> 200 to """{"ok":true}""" })
        assertEquals(CheckResult.NotTorsher, check { _, _ -> 200 to "<html>" })
    }

    @Test
    fun unreachableWhenRequestFails() {
        assertEquals(CheckResult.Unreachable, check { _, _ -> throw IOException("refused") })
    }

    @Test
    fun timeoutWhenServerIsSilent() {
        assertEquals(CheckResult.Timeout, check { _, _ -> throw SocketTimeoutException() })
    }
}
