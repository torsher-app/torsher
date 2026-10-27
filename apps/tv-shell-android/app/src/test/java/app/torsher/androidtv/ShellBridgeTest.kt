package app.torsher.androidtv

import android.view.KeyEvent
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ShellBridgeTest {
    @Test
    fun parsesShowcaseMessages() {
        assertEquals(ShowcaseMessage.Ready, parseShowcaseMessage("""{"type":"ready"}"""))
        assertEquals(ShowcaseMessage.BackUnhandled, parseShowcaseMessage("""{"type":"back.unhandled"}"""))
        assertEquals(ShowcaseMessage.ChangeServer, parseShowcaseMessage("""{"type":"server.change"}"""))
        assertEquals(
            ShowcaseMessage.KeepScreenOn(true),
            parseShowcaseMessage("""{"type":"screen.keepOn","on":true}"""),
        )
    }

    @Test
    fun ignoresUnknownAndBrokenMessages() {
        assertNull(parseShowcaseMessage("""{"type":"player.fly"}"""))
        assertNull(parseShowcaseMessage("not json"))
    }

    @Test
    fun documentStartScriptDeclaresTheShell() {
        val script = documentStartScript("1.0.0", deviceProfileJson(setOf("video/avc"), setOf("audio/mp4a-latm")))

        assertTrue(script.startsWith("window.TorsherShell = Object.freeze({"))
        assertTrue(script.contains(""""platform":"android""""))
        assertTrue(script.contains(""""bridge":"torsherBridge""""))
    }

    @Test
    fun keyEventCarriesTheShowcaseKeyCode() {
        val event = JSONObject(ShellEvent.key(166))

        assertEquals("key", event.getString("type"))
        assertEquals(166, event.getInt("keyCode"))
    }

    @Test
    fun mapsRemoteKeysToShowcaseCodes() {
        assertEquals(166, showcaseKeyCode(KeyEvent.KEYCODE_BACK))
        assertEquals(179, showcaseKeyCode(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE))
        assertEquals(228, showcaseKeyCode(KeyEvent.KEYCODE_MEDIA_FAST_FORWARD))
        assertNull(showcaseKeyCode(KeyEvent.KEYCODE_DPAD_UP))
    }

    @Test
    fun profileListsCodecsByFfprobeNames() {
        val profile = deviceProfileJson(
            setOf("video/avc", "video/hevc"),
            setOf("audio/mp4a-latm", "audio/eac3", "audio/vnd.dts"),
        )

        assertEquals("[\"h264\",\"hevc\"]", profile.getJSONArray("video").toString())
        assertEquals("[\"aac\",\"eac3\",\"dts\"]", profile.getJSONArray("audio").toString())
        assertEquals("[\"aac\",\"eac3\",\"dts\"]", profile.getJSONArray("hlsAudio").toString())
        assertTrue(profile.getBoolean("hls"))
        assertTrue(profile.getBoolean("audioTracks"))
    }

    @Test
    fun parsesPlayerCommands() {
        assertEquals(
            ShowcaseMessage.Player(PlayerCommand.Load("http://tv/a.mkv")),
            parseShowcaseMessage("""{"type":"player.load","url":"http://tv/a.mkv"}"""),
        )
        assertEquals(
            ShowcaseMessage.Player(PlayerCommand.Seek(42.5)),
            parseShowcaseMessage("""{"type":"player.seek","time":42.5}"""),
        )
        assertEquals(
            ShowcaseMessage.Player(PlayerCommand.Audio(1)),
            parseShowcaseMessage("""{"type":"player.audio","index":1}"""),
        )
        assertNull(parseShowcaseMessage("""{"type":"player.seek","time":-1}"""))
        assertNull(parseShowcaseMessage("""{"type":"player.load"}"""))
    }
}
