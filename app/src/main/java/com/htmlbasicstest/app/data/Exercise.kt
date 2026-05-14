package com.htmlbasicstest.app.data

data class Choice(
    val id: String,
    val label: String,
)

// Three question types. Correct answers are NOT stored in the app on purpose:
// grading lives on the server so the answer key cannot be peeked at from an APK.
sealed class Exercise {
    abstract val id: Int
    abstract val title: String
    abstract val prompt: String

    data class MultipleChoice(
        override val id: Int,
        override val title: String,
        override val prompt: String,
        val choices: List<Choice>,
    ) : Exercise()

    data class ShortText(
        override val id: Int,
        override val title: String,
        override val prompt: String,
        val placeholder: String = "Type your answer",
    ) : Exercise()

    data class FillBlank(
        override val id: Int,
        override val title: String,
        override val prompt: String,
        // Code snippet shown above the input. Use "____" (four underscores) where the blank goes.
        val code: String,
        val placeholder: String = "Type only what fills the blank",
    ) : Exercise()
}
