package io.github.xaxan1990hub.cryptoadvisor

import android.content.Context
import android.net.Uri
import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** Only these read-only public feeds are reachable from the packaged interface. */
internal class MarketGateway(context: Context) {
    private val cache = File(context.filesDir, "market-v1").apply { mkdirs() }
    private val locks = Array(16) { Any() }
    private val feeds = context.assets.open("models/config.json").bufferedReader().use {
        JSONObject(it.readText()).getJSONObject("NEWS_FEEDS")
    }
    private data class Feed(val url: String, val ttlMinutes: Int, val format: String = "array")

    private fun feed(kind: String, id: String): Feed {
        val gecko = "https://api.coingecko.com/api/v3"
        require(id.matches(Regex("[A-Za-z0-9._-]{0,128}")))
        return when (kind) {
            "market" -> Feed("$gecko/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=160&page=1&sparkline=false&price_change_percentage=24h,7d,30d", 10)
            "fear" -> Feed("https://api.alternative.me/fng/?limit=1000&format=json", 360, "object")
            "candles" -> Feed("https://data-api.binance.vision/api/v3/klines?symbol=${id}USDT&interval=1d&limit=1000", 60)
            "chart" -> Feed("$gecko/coins/$id/market_chart?vs_currency=usd&days=365&interval=daily", 180, "object")
            "funding" -> Feed("https://fapi.binance.com/fapi/v1/fundingRate?symbol=${id}USDT&limit=18", 240)
            "fx" -> Feed("https://www.cbr-xml-daily.ru/daily_json.js", 720, "object")
            "fx_usdt" -> Feed("$gecko/simple/price?ids=tether&vs_currencies=rub", 10, "object")
            "release" -> Feed("https://api.github.com/repos/xaxan1990-hub/crypto-advisor-android/releases?per_page=1", 60, "array")
            "news" -> Feed(feeds.getString(id), 30, "xml")
            else -> throw IllegalArgumentException("Неизвестный источник")
        }
    }

    fun read(uri: Uri): String {
        val kind = uri.lastPathSegment.orEmpty()
        val id = uri.getQueryParameter("id").orEmpty()
        val source = feed(kind, id)
        val key = "$kind-$id"
        synchronized(locks[(key.hashCode() and Int.MAX_VALUE) % locks.size]) {
            val file = AtomicFile(File(cache, "$key.json"))
            val now = System.currentTimeMillis()
            val saved = runCatching { JSONObject(String(file.readFully(), Charsets.UTF_8)) }.getOrNull()
            val ttl = if (uri.getQueryParameter("refresh") == "1") 30_000L else source.ttlMinutes * 60_000L
            if (saved != null && now - saved.getLong("at") in 0 until ttl) return saved.toString()
            try {
                val connection = URL(source.url).openConnection() as HttpURLConnection
                val body = try {
                    connection.connectTimeout = 8000
                    connection.readTimeout = 12000
                    connection.setRequestProperty("User-Agent", "CryptoAdvisorAndroid/0.2")
                    if (source.url.startsWith("https://api.github.com/")) {
                        connection.setRequestProperty("Accept", "application/vnd.github+json")
                    }
                    if (connection.responseCode != 200) throw IOException("HTTP ${connection.responseCode}")
                    connection.inputStream.bufferedReader().use { it.readText() }
                } finally { connection.disconnect() }
                val payload: Any = when (source.format) {
                    "object" -> JSONObject(body)
                    "xml" -> body.also { require(it.contains("<rss", true) || it.contains("<feed", true) || it.contains("<rdf:RDF", true)) }
                    else -> JSONArray(body).also { require(it.length() > 0) }
                }
                val fresh = JSONObject().put("at", now).put("data", payload)
                val serialized = fresh.toString()
                val stream = file.startWrite()
                try {
                    stream.write(serialized.toByteArray())
                    file.finishWrite(stream)
                } catch (e: Exception) {
                    file.failWrite(stream)
                    throw e
                }
                return serialized
            } catch (e: Exception) {
                if (saved != null) return saved.put("stale", true).toString()
                throw e
            }
        }
    }
}
