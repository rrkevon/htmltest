package com.htmlbasicstest.app.network

import retrofit2.http.Body
import retrofit2.http.POST

interface SubmissionApi {
    @POST("api/submissions.php")
    suspend fun submit(@Body body: SubmissionPayload): SubmissionResponse
}
