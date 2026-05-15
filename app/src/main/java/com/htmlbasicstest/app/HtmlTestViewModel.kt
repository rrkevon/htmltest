package com.htmlbasicstest.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.htmlbasicstest.app.data.Exercise
import com.htmlbasicstest.app.network.AnswerPayload
import com.htmlbasicstest.app.network.ApiFactory
import com.htmlbasicstest.app.network.SubmissionPayload
import com.htmlbasicstest.app.network.toExercise
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.format.DateTimeFormatter

enum class QuizLoadState {
    Loading,
    NoTest,
    Ready,
    Error,
}

data class HtmlTestUiState(
    val participantLabel: String = "",
    val screen: TestScreen = TestScreen.Intro,
    val currentIndex: Int = 0,
    val orderedExercises: List<Exercise> = emptyList(),
    val answers: Map<Int, String> = emptyMap(),
    val submitMessage: String? = null,
    val isSubmitting: Boolean = false,
    val quizLoadState: QuizLoadState = QuizLoadState.Loading,
    /** From server; required on submit. */
    val quizRevision: Int = 0,
    val quizMessage: String? = null,
    /** Unshuffled list from GET /api/quiz.php (used to build session order and canonical submit order). */
    val canonicalExercises: List<Exercise> = emptyList(),
)

sealed class TestScreen {
    data object Intro : TestScreen()
    data object Question : TestScreen()
    data object Review : TestScreen()
    data object Done : TestScreen()
}

class HtmlTestViewModel : ViewModel() {
    private val submissionApi = ApiFactory.submissionApi()
    private val quizApi = ApiFactory.quizApi()

    private val _state = MutableStateFlow(HtmlTestUiState())
    val state: StateFlow<HtmlTestUiState> = _state.asStateFlow()

    init {
        refreshQuiz()
    }

    fun setParticipantLabel(value: String) {
        _state.update { it.copy(participantLabel = value) }
    }

    fun refreshQuiz() {
        viewModelScope.launch {
            _state.update {
                it.copy(
                    quizLoadState = QuizLoadState.Loading,
                    submitMessage = null,
                    canonicalExercises = emptyList(),
                    orderedExercises = emptyList(),
                    screen = TestScreen.Intro,
                    currentIndex = 0,
                    answers = emptyMap(),
                )
            }
            val result = runCatching { quizApi.getQuiz() }
            result.fold(
                onSuccess = { res ->
                    if (!res.ok) {
                        _state.update {
                            it.copy(
                                quizLoadState = QuizLoadState.Error,
                                quizMessage = "Server returned an error.",
                            )
                        }
                        return@fold
                    }
                    if (!res.active || res.exercises.isNullOrEmpty()) {
                        _state.update {
                            it.copy(
                                quizLoadState = QuizLoadState.NoTest,
                                quizRevision = res.revision,
                                quizMessage = res.message,
                                canonicalExercises = emptyList(),
                                orderedExercises = emptyList(),
                            )
                        }
                        return@fold
                    }
                    val list = res.exercises.mapNotNull { it.toExercise() }
                    if (list.size != res.exercises.size) {
                        _state.update {
                            it.copy(
                                quizLoadState = QuizLoadState.Error,
                                quizMessage = "Invalid quiz data from server.",
                            )
                        }
                        return@fold
                    }
                    _state.update {
                        it.copy(
                            quizLoadState = QuizLoadState.Ready,
                            quizRevision = res.revision,
                            quizMessage = res.message,
                            canonicalExercises = list,
                        )
                    }
                },
                onFailure = { e ->
                    _state.update {
                        it.copy(
                            quizLoadState = QuizLoadState.Error,
                            quizMessage = e.message ?: "Could not reach server",
                        )
                    }
                },
            )
        }
    }

    private fun buildSessionOrder(canonical: List<Exercise>): List<Exercise> {
        return canonical.shuffled().map { ex ->
            when (ex) {
                is Exercise.MultipleChoice -> ex.copy(choices = ex.choices.shuffled())
                is Exercise.ShortText, is Exercise.FillBlank -> ex
            }
        }
    }

    fun startTest() {
        val s = _state.value
        if (s.quizLoadState != QuizLoadState.Ready) return
        val canonical = s.canonicalExercises
        if (canonical.isEmpty()) return
        _state.update {
            it.copy(
                screen = TestScreen.Question,
                currentIndex = 0,
                answers = emptyMap(),
                orderedExercises = buildSessionOrder(canonical),
                submitMessage = null,
            )
        }
    }

    fun selectChoice(choiceId: String) {
        val s = _state.value
        val ex = s.orderedExercises.getOrNull(s.currentIndex) ?: return
        if (ex !is Exercise.MultipleChoice) return
        _state.update { it.copy(answers = it.answers + (ex.id to choiceId)) }
    }

    fun setTypedAnswer(text: String) {
        val s = _state.value
        val ex = s.orderedExercises.getOrNull(s.currentIndex) ?: return
        if (ex is Exercise.MultipleChoice) return
        _state.update { it.copy(answers = it.answers + (ex.id to text)) }
    }

    private fun hasValidAnswer(ex: Exercise, answers: Map<Int, String>): Boolean {
        val v = answers[ex.id] ?: return false
        return when (ex) {
            is Exercise.MultipleChoice -> v.isNotEmpty()
            is Exercise.ShortText, is Exercise.FillBlank -> v.isNotBlank()
        }
    }

    fun next() {
        val s = _state.value
        if (s.screen != TestScreen.Question) return
        val ex = s.orderedExercises.getOrNull(s.currentIndex) ?: return
        if (!hasValidAnswer(ex, s.answers)) return
        if (s.currentIndex < s.orderedExercises.lastIndex) {
            _state.update { it.copy(currentIndex = it.currentIndex + 1) }
        } else {
            _state.update { it.copy(screen = TestScreen.Review) }
        }
    }

    fun back() {
        val s = _state.value
        if (s.screen != TestScreen.Question) return
        if (s.currentIndex > 0) {
            _state.update { it.copy(currentIndex = it.currentIndex - 1) }
        }
    }

    fun editAnswers() {
        _state.update {
            it.copy(
                screen = TestScreen.Question,
                currentIndex = 0,
            )
        }
    }

    fun submit() {
        val s = _state.value
        if (s.isSubmitting) return
        val sessionExercises = s.orderedExercises
        val firstUnanswered = sessionExercises.indexOfFirst { !hasValidAnswer(it, s.answers) }
        if (firstUnanswered >= 0) {
            _state.update {
                it.copy(submitMessage = "Answer all ${sessionExercises.size} questions before submitting.")
            }
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(isSubmitting = true, submitMessage = null) }
            val iso = DateTimeFormatter.ISO_INSTANT.format(Instant.now())
            val payload = SubmissionPayload(
                participantLabel = s.participantLabel.ifBlank { null },
                clientSubmittedAt = iso,
                quizRevision = s.quizRevision,
                answers = sessionExercises.sortedBy { it.id }.map { ex ->
                    val raw = s.answers[ex.id] ?: ""
                    when (ex) {
                        is Exercise.MultipleChoice -> AnswerPayload(
                            exerciseId = ex.id,
                            selectedChoiceId = raw,
                        )
                        is Exercise.ShortText,
                        is Exercise.FillBlank -> AnswerPayload(
                            exerciseId = ex.id,
                            typedAnswer = raw,
                        )
                    }
                },
            )
            val result = runCatching { submissionApi.submit(payload) }
            result.fold(
                onSuccess = { res ->
                    if (res.ok) {
                        _state.update {
                            it.copy(
                                isSubmitting = false,
                                screen = TestScreen.Done,
                                submitMessage = "Submitted. Reference: ${res.id ?: "ok"}",
                            )
                        }
                    } else {
                        _state.update {
                            it.copy(
                                isSubmitting = false,
                                submitMessage = "Server error: ${res.error ?: "unknown"}",
                            )
                        }
                    }
                },
                onFailure = { e ->
                    _state.update {
                        it.copy(
                            isSubmitting = false,
                            submitMessage = "Could not reach server: ${e.message ?: "error"}",
                        )
                    }
                },
            )
        }
    }

    fun dismissSubmitError() {
        _state.update { it.copy(submitMessage = null) }
    }

    fun resetToIntro() {
        _state.value = HtmlTestUiState()
        refreshQuiz()
    }
}
