package io.github.xaxan1990hub.cryptoadvisor

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.Locale

/** Checks a small saved list of price targets and posts a local notification once per target. */
class AlertWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val raw = AlertStore.read(applicationContext)
        val alerts = runCatching { JSONArray(raw) }.getOrNull() ?: return Result.success()
        val active = (0 until alerts.length()).mapNotNull { alerts.optJSONObject(it) }
            .filter { it.optBoolean("enabled", true) }
        if (active.isEmpty() || !notificationsAllowed()) return Result.success()

        val ids = active.mapNotNull { it.optString("coin").takeIf(String::isNotBlank) }.distinct()
        if (ids.isEmpty()) return Result.success()
        val data = try {
            JSONObject(fetch(ids))
        } catch (_: Exception) {
            return Result.success()
        }

        var changed = false
        for (alert in active) {
            val coin = alert.optString("coin")
            val price = data.optJSONObject(coin)?.optDouble("usd", Double.NaN) ?: continue
            val target = alert.optDouble("targetUsd", Double.NaN)
            if (!price.isFinite() || price <= 0 || !target.isFinite() || target <= 0) continue
            val above = alert.optBoolean("above", true)
            val hit = if (above) price >= target else price <= target
            if (!hit) continue
            notify(alert, price, target)
            alert.put("enabled", false)
            alert.put("triggeredAt", System.currentTimeMillis())
            alert.put("triggeredPrice", price)
            changed = true
        }
        if (changed) {
            runCatching { AlertStore.write(applicationContext, alerts.toString()) }
        }
        return Result.success()
    }

    private fun notificationsAllowed(): Boolean {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(applicationContext, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return false
        return NotificationManagerCompat.from(applicationContext).areNotificationsEnabled()
    }

    private fun fetch(ids: List<String>): String {
        val query = URLEncoder.encode(ids.joinToString(","), "UTF-8")
        val connection = URL("https://api.coingecko.com/api/v3/simple/price?ids=$query&vs_currencies=usd")
            .openConnection() as HttpURLConnection
        return try {
            connection.connectTimeout = 10_000
            connection.readTimeout = 15_000
            connection.setRequestProperty("User-Agent", "CryptoAdvisorAndroid/${BuildConfig.VERSION_NAME}")
            if (connection.responseCode != 200) throw IllegalStateException("HTTP ${connection.responseCode}")
            connection.inputStream.bufferedReader().use { it.readText() }
        } finally {
            connection.disconnect()
        }
    }

    private fun notify(alert: JSONObject, price: Double, target: Double) {
        val manager = applicationContext.getSystemService(NotificationManager::class.java) ?: return
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL, "Цена монет", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "Срабатывание заданных ценовых целей"
                }
            )
        }
        val symbol = alert.optString("symbol", alert.optString("coin", "Монета")).uppercase(Locale.ROOT)
        val label = alert.optString("targetLabel").takeIf { it.isNotBlank() } ?: "$" + formatPrice(target)
        val intent = Intent(applicationContext, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val pending = PendingIntent.getActivity(
            applicationContext,
            alert.optString("key", symbol).hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(applicationContext, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("$symbol: цель достигнута")
            .setContentText("Сейчас $${formatPrice(price)} · цель $label")
            .setStyle(NotificationCompat.BigTextStyle().bigText("Сейчас $${formatPrice(price)}. Заданная цель: $label."))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()
        runCatching {
            NotificationManagerCompat.from(applicationContext)
                .notify(alert.optString("key", symbol).hashCode(), notification)
        }
    }

    private fun formatPrice(value: Double): String = when {
        value >= 1 -> String.format(Locale.US, "%,.2f", value)
        value >= 0.01 -> String.format(Locale.US, "%.5f", value).trimEnd('0').trimEnd('.')
        else -> String.format(Locale.US, "%.9f", value).trimEnd('0').trimEnd('.')
    }

    companion object {
        private const val CHANNEL = "price-alerts"
    }
}
