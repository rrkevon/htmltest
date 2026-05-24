package com.htmlbasicstest.app.network

import com.google.gson.Gson
import com.htmlbasicstest.app.BuildConfig
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.HttpException
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.io.IOException
import java.net.SocketTimeoutException
import java.util.concurrent.TimeUnit

object ApiFactory {
    /**
     * Render free tier sleeps after ~15 min idle; first request can take 1–2 minutes to connect.
     */
    private const val CONNECT_TIMEOUT_SEC = 90L
    private const val READ_TIMEOUT_SEC = 120L
    private const val WRITE_TIMEOUT_SEC = 60L
    private const val CALL_TIMEOUT_SEC = 150L

    private val gson = Gson()

    /** User-facing hint when OkHttp times out during a cold start. */
    fun messageForNetworkFailure(e: Throwable, action: String): String {
        val timeout = e is SocketTimeoutException ||
            (e is IOException && e.message?.contains("timeout", ignoreCase = true) == true)
        return if (timeout) {
            "The class server is waking up (free hosting). Wait up to 2 minutes, then tap Retry to $action."
        } else {
            "Could not reach server: ${e.message ?: "check Wi-Fi and try again"}"
        }
    }

    /** Parses JSON error bodies from failed POST /api/submissions (HTTP 400, etc.). */
    fun messageForSubmitFailure(e: Throwable): String {
        if (e is HttpException) {
            val serverError = e.response()?.errorBody()?.use { body ->
                runCatching {
                    gson.fromJson(body.string(), SubmissionResponse::class.java)?.error
                }.getOrNull()
            }
            if (!serverError.isNullOrBlank()) {
                return messageForServerError(serverError)
            }
            if (e.code() == 400) {
                return "Server rejected the submission. Tap Start over below, wait for the quiz to load, then try again."
            }
        }
        return messageForNetworkFailure(e, "submit")
    }

    private fun messageForServerError(code: String): String = when (code) {
        "quiz_revision" ->
            "This quiz was updated on the server (version changed). Tap Start over below, load the quiz again, then retake it."
        "answers_count", "missing_exercise_id", "unexpected_exercise_id", "duplicate_exercise_id" ->
            "Your answers do not match the quiz on the server. Tap Start over below and try again."
        "no_active_quiz" ->
            "No test is active on the server right now. Ask your teacher to turn the quiz on."
        "exercise_id_range", "answer_shape" ->
            "Invalid answer data. Tap Start over below and try again."
        else -> "Server error: $code"
    }

    fun isRecoverableSubmitError(message: String?): Boolean {
        if (message.isNullOrBlank()) return false
        return message.contains("Start over", ignoreCase = true) ||
            message.contains("server error", ignoreCase = true)
    }

    private fun retrofit(baseUrl: String = BuildConfig.SUBMIT_BASE_URL): Retrofit {
        val normalized = if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/"
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BASIC
        }
        val client = OkHttpClient.Builder()
            .connectTimeout(CONNECT_TIMEOUT_SEC, TimeUnit.SECONDS)
            .readTimeout(READ_TIMEOUT_SEC, TimeUnit.SECONDS)
            .writeTimeout(WRITE_TIMEOUT_SEC, TimeUnit.SECONDS)
            .callTimeout(CALL_TIMEOUT_SEC, TimeUnit.SECONDS)
            .addInterceptor { chain ->
                val req = chain.request().newBuilder()
                    .header("User-Agent", "HtmlBasicsTest-v2/1.0 (Android)")
                    .build()
                chain.proceed(req)
            }
            .addInterceptor(logging)
            .build()
        return Retrofit.Builder()
            .baseUrl(normalized)
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }

    fun submissionApi(baseUrl: String = BuildConfig.SUBMIT_BASE_URL): SubmissionApi =
        retrofit(baseUrl).create(SubmissionApi::class.java)

    fun quizApi(baseUrl: String = BuildConfig.SUBMIT_BASE_URL): QuizApi =
        retrofit(baseUrl).create(QuizApi::class.java)
}
