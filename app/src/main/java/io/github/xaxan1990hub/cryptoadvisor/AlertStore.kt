package io.github.xaxan1990hub.cryptoadvisor

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import org.json.JSONArray
import java.util.concurrent.TimeUnit

/** Shared storage for price alerts and the background check schedule. */
internal object AlertStore {
    private const val PREFS = "price-alerts"
    private const val KEY = "items"
    const val WORK_NAME = "price-alerts"

    fun read(context: Context): String =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]") ?: "[]"

    fun write(context: Context, json: String) {
        val array = JSONArray(json)
        require(array.length() <= 100) { "Слишком много уведомлений" }
        require(json.length <= 200_000) { "Слишком большой список" }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY, array.toString()).commit()
    }

    fun schedule(context: Context) {
        val active = runCatching {
            val array = JSONArray(read(context))
            (0 until array.length()).count { array.optJSONObject(it)?.optBoolean("enabled", true) == true } > 0
        }.getOrDefault(false)
        val manager = WorkManager.getInstance(context)
        if (!active) {
            manager.cancelUniqueWork(WORK_NAME)
            return
        }
        val request = PeriodicWorkRequestBuilder<AlertWorker>(15, TimeUnit.MINUTES)
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
            )
            .build()
        manager.enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
    }
}
