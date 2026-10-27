package app.torsher.androidtv

import android.content.Context
import androidx.core.content.edit

/** Адрес сервера между запусками: тот же ключ, что у обёртки webOS */
class ServerStore(context: Context) {
    private val preferences = context.getSharedPreferences("torsher", Context.MODE_PRIVATE)

    fun load(): String? = preferences.getString(KEY, null)

    fun save(base: String) = preferences.edit { putString(KEY, base) }

    private companion object {
        const val KEY = "torsher.server"
    }
}
