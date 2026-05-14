package com.htmlbasicstest.app.network

import com.google.gson.annotations.SerializedName

// One of selectedChoiceId / typedAnswer will be non-null depending on the question type.
data class AnswerPayload(
    @SerializedName("exerciseId") val exerciseId: Int,
    @SerializedName("selectedChoiceId") val selectedChoiceId: String? = null,
    @SerializedName("typedAnswer") val typedAnswer: String? = null,
)

data class SubmissionPayload(
    @SerializedName("participantLabel") val participantLabel: String?,
    @SerializedName("clientSubmittedAt") val clientSubmittedAt: String,
    @SerializedName("answers") val answers: List<AnswerPayload>,
)

data class SubmissionResponse(
    @SerializedName("ok") val ok: Boolean,
    @SerializedName("id") val id: String?,
    @SerializedName("error") val error: String?,
)
