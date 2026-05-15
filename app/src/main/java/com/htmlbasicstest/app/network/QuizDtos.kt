package com.htmlbasicstest.app.network

import com.google.gson.annotations.SerializedName
import com.htmlbasicstest.app.data.Choice
import com.htmlbasicstest.app.data.Exercise

data class QuizChoiceDto(
    @SerializedName("id") val id: String,
    @SerializedName("label") val label: String,
)

data class QuizExerciseDto(
    @SerializedName("id") val id: Int,
    @SerializedName("type") val type: String,
    @SerializedName("title") val title: String,
    @SerializedName("prompt") val prompt: String,
    @SerializedName("choices") val choices: List<QuizChoiceDto>? = null,
    @SerializedName("code") val code: String? = null,
    @SerializedName("placeholder") val placeholder: String? = null,
)

data class QuizResponse(
    @SerializedName("ok") val ok: Boolean,
    @SerializedName("active") val active: Boolean = false,
    @SerializedName("revision") val revision: Int = 1,
    @SerializedName("message") val message: String? = null,
    @SerializedName("exercises") val exercises: List<QuizExerciseDto>? = null,
)

fun QuizExerciseDto.toExercise(): Exercise? {
    return when (type) {
        "mcq" -> {
            val ch = choices ?: return null
            Exercise.MultipleChoice(
                id = id,
                title = title,
                prompt = prompt,
                choices = ch.map { Choice(id = it.id, label = it.label) },
            )
        }
        "short" -> Exercise.ShortText(
            id = id,
            title = title,
            prompt = prompt,
            placeholder = placeholder ?: "Type your answer",
        )
        "fill" -> {
            val c = code ?: return null
            Exercise.FillBlank(
                id = id,
                title = title,
                prompt = prompt,
                code = c,
                placeholder = placeholder ?: "Type only what fills the blank",
            )
        }
        else -> null
    }
}
