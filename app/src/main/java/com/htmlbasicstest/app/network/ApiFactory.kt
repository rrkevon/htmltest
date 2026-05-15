package com.htmlbasicstest.app.network

import com.htmlbasicstest.app.BuildConfig
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object ApiFactory {
    private fun retrofit(baseUrl: String = BuildConfig.SUBMIT_BASE_URL): Retrofit {
        val normalized = if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/"
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BASIC
        }
        val client = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
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
