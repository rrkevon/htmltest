package com.htmlbasicstest.app.network

import retrofit2.http.GET

interface QuizApi {
    @GET("api/quiz.php")
    suspend fun getQuiz(): QuizResponse
}
