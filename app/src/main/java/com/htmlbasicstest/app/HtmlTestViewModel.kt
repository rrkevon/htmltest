package com.htmlbasicstest.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.htmlbasicstest.app.data.Exercise
import com.htmlbasicstest.app.data.ExerciseBank
import com.htmlbasicstest.app.network.AnswerPayload
import com.htmlbasicstest.app.network.ApiFactory
import com.htmlbasicstest.app.network.SubmissionPayload
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.format.DateTimeFormatter

data class HtmlTestUiState(
    val participantLabel: String = "",
    val screen: TestScreen = TestScreen.Intro,
    val currentIndex: Int = 0,
    // The exercises in this session's randomized order. For MCQ exercises, the inner
    // `choices` list has also been shuffled (the choice ids stay stable, only the
    // display order changes, so the server still grades correctly).
    val orderedExercises: List<Exercise> = emptyList(),
    // For MCQ this stores the chosen choice id; for ShortText / FillBlank it stores the raw typed text.
    val answers: Map<Int, String> = emptyMap(),
    val submitMessage: String? = null,
    val isSubmitting: Boolean = false,
)

sealed class TestScreen {
    data object Intro : TestScreen()
    data object Question : TestScreen()
    data object Review : TestScreen()
    data object Done : TestScreen()
}

class HtmlTestViewModel : ViewModel() {
    private val api = ApiFactory.submissionApi()

    private val _state = MutableStateFlow(HtmlTestUiState())
    val state: StateFlow<HtmlTestUiState> = _state.asStateFlow()

    fun setParticipantLabel(value: String) {
        _state.update { it.copy(participantLabel = value) }
    }

    // Build a fresh randomized list for this session: question order is shuffled,
    // and within each MCQ the choices are shuffled too. IDs stay stable so the
    // server grades by id, not by display position.
    private fun buildSessionOrder(): List<Exercise> {
        return ExerciseBank.exercises.shuffled().map { ex ->
            when (ex) {
                is Exercise.MultipleChoice -> ex.copy(choices = ex.choices.shuffled())
                is Exercise.ShortText, is Exercise.FillBlank -> ex
            }
        }
    }

    fun startTest() {
        _state.update {
            it.copy(
                screen = TestScreen.Question,
                currentIndex = 0,
                answers = emptyMap(),
                orderedExercises = buildSessionOrder(),
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
        // Keep the student's raw text; trimming and lowercasing happen on the server during grading.
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
                // Send answers in canonical id order (1..30) regardless of display order,
                // so server output is consistent across sessions.
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
            val result = runCatching { api.submit(payload) }
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
    }
}
