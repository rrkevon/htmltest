package com.htmlbasicstest.app.data

import android.content.Context
import com.google.gson.Gson
import com.google.gson.annotations.SerializedName
import com.htmlbasicstest.app.TestScreen

private const val PREFS = "html_test_session"
private const val KEY_JSON = "session_json"

data class SavedChoice(
    @SerializedName("id") val id: String,
    @SerializedName("label") val label: String,
)

data class SavedExercise(
    @SerializedName("id") val id: Int,
    @SerializedName("type") val type: String,
    @SerializedName("title") val title: String,
    @SerializedName("prompt") val prompt: String,
    @SerializedName("choices") val choices: List<SavedChoice>? = null,
    @SerializedName("code") val code: String? = null,
    @SerializedName("placeholder") val placeholder: String? = null,
)

data class SavedQuizSession(
    @SerializedName("quizRevision") val quizRevision: Int,
    @SerializedName("participantLabel") val participantLabel: String,
    @SerializedName("screen") val screen: String,
    @SerializedName("currentIndex") val currentIndex: Int,
    @SerializedName("orderedExercises") val orderedExercises: List<SavedExercise>,
    @SerializedName("answers") val answers: Map<String, String>,
    @SerializedName("savedAtEpochMs") val savedAtEpochMs: Long,
)

class QuizSessionStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val gson = Gson()

    fun save(
        quizRevision: Int,
        participantLabel: String,
        screen: TestScreen,
        currentIndex: Int,
        orderedExercises: List<Exercise>,
        answers: Map<Int, String>,
    ) {
        if (screen != TestScreen.Question && screen != TestScreen.Review) {
            clear()
            return
        }
        val saved = SavedQuizSession(
            quizRevision = quizRevision,
            participantLabel = participantLabel,
            screen = when (screen) {
                TestScreen.Question -> "question"
                TestScreen.Review -> "review"
                else -> return
            },
            currentIndex = currentIndex,
            orderedExercises = orderedExercises.map { it.toSaved() },
            answers = answers.mapKeys { it.key.toString() },
            savedAtEpochMs = System.currentTimeMillis(),
        )
        prefs.edit().putString(KEY_JSON, gson.toJson(saved)).apply()
    }

    fun load(): SavedQuizSession? {
        val raw = prefs.getString(KEY_JSON, null) ?: return null
        return runCatching { gson.fromJson(raw, SavedQuizSession::class.java) }.getOrNull()
    }

    fun clear() {
        prefs.edit().remove(KEY_JSON).apply()
    }
}

private fun Exercise.toSaved(): SavedExercise = when (this) {
    is Exercise.MultipleChoice -> SavedExercise(
        id = id,
        type = "mcq",
        title = title,
        prompt = prompt,
        choices = choices.map { SavedChoice(it.id, it.label) },
    )
    is Exercise.ShortText -> SavedExercise(
        id = id,
        type = "short",
        title = title,
        prompt = prompt,
        placeholder = placeholder,
    )
    is Exercise.FillBlank -> SavedExercise(
        id = id,
        type = "fill",
        title = title,
        prompt = prompt,
        code = code,
        placeholder = placeholder,
    )
}

fun SavedExercise.toExercise(): Exercise? {
    return when (type) {
        "mcq" -> {
            val ch = choices ?: return null
            Exercise.MultipleChoice(
                id = id,
                title = title,
                prompt = prompt,
                choices = ch.map { Choice(it.id, it.label) },
            )
        }
        "short" -> Exercise.ShortText(
            id = id,
            title = title,
            prompt = prompt,
            placeholder = placeholder ?: "Type your answer",
        )
        "fill" -> {
            val snippet = code ?: return null
            Exercise.FillBlank(
                id = id,
                title = title,
                prompt = prompt,
                code = snippet,
                placeholder = placeholder ?: "Type only what fills the blank",
            )
        }
        else -> null
    }
}

fun SavedQuizSession.toRestoredScreen(): TestScreen? = when (screen) {
    "question" -> TestScreen.Question
    "review" -> TestScreen.Review
    else -> null
}
