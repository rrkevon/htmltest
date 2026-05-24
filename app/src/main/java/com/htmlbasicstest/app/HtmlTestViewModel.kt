package com.htmlbasicstest.app

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.htmlbasicstest.app.data.Exercise
import com.htmlbasicstest.app.data.QuizSessionStore
import com.htmlbasicstest.app.data.toExercise
import com.htmlbasicstest.app.data.toRestoredScreen
import com.htmlbasicstest.app.network.AnswerPayload
import com.htmlbasicstest.app.network.ApiFactory
import com.htmlbasicstest.app.network.SubmissionPayload
import com.htmlbasicstest.app.network.toExercise as quizDtoToExercise
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
    /** Shown once after reopening the app with saved progress. */
    val progressRestoredNotice: Boolean = false,
)

sealed class TestScreen {
    data object Intro : TestScreen()
    data object Question : TestScreen()
    data object Review : TestScreen()
    data object Done : TestScreen()
}

class HtmlTestViewModel(application: Application) : AndroidViewModel(application) {
    private val submissionApi = ApiFactory.submissionApi()
    private val quizApi = ApiFactory.quizApi()
    private val sessionStore = QuizSessionStore(application)

    private val _state = MutableStateFlow(HtmlTestUiState())
    val state: StateFlow<HtmlTestUiState> = _state.asStateFlow()

    init {
        refreshQuiz()
    }

    fun setParticipantLabel(value: String) {
        _state.update { it.copy(participantLabel = value) }
        if (_state.value.screen == TestScreen.Question || _state.value.screen == TestScreen.Review) {
            persistSession()
        }
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
                    progressRestoredNotice = false,
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
                        sessionStore.clear()
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
                    val list = res.exercises.mapNotNull { it.quizDtoToExercise() }
                    if (list.size != res.exercises.size) {
                        _state.update {
                            it.copy(
                                quizLoadState = QuizLoadState.Error,
                                quizMessage = "Invalid quiz data from server.",
                            )
                        }
                        return@fold
                    }
                    if (tryRestoreSavedSession(list, res.revision, res.message)) {
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
                            quizMessage = ApiFactory.messageForNetworkFailure(e, "load the quiz"),
                        )
                    }
                },
            )
        }
    }

    private fun tryRestoreSavedSession(
        canonical: List<Exercise>,
        revision: Int,
        quizMessage: String?,
    ): Boolean {
        val saved = sessionStore.load() ?: return false
        if (saved.quizRevision != revision) {
            sessionStore.clear()
            return false
        }
        val canonicalIds = canonical.map { it.id }.toSet()
        val savedIds = saved.orderedExercises.map { it.id }.toSet()
        if (savedIds != canonicalIds) {
            sessionStore.clear()
            return false
        }
        val exercises = saved.orderedExercises.mapNotNull { it.toExercise() }
        if (exercises.size != saved.orderedExercises.size) {
            sessionStore.clear()
            return false
        }
        val screen = saved.toRestoredScreen() ?: run {
            sessionStore.clear()
            return false
        }
        val index = saved.currentIndex.coerceIn(0, (exercises.size - 1).coerceAtLeast(0))
        _state.update {
            it.copy(
                quizLoadState = QuizLoadState.Ready,
                quizRevision = revision,
                quizMessage = quizMessage,
                canonicalExercises = canonical,
                participantLabel = saved.participantLabel,
                screen = screen,
                currentIndex = if (screen == TestScreen.Review) 0 else index,
                orderedExercises = exercises,
                answers = saved.answers.mapKeys { it.key.toInt() },
                progressRestoredNotice = true,
                submitMessage = null,
            )
        }
        persistSession()
        return true
    }

    private fun persistSession() {
        val s = _state.value
        sessionStore.save(
            quizRevision = s.quizRevision,
            participantLabel = s.participantLabel,
            screen = s.screen,
            currentIndex = s.currentIndex,
            orderedExercises = s.orderedExercises,
            answers = s.answers,
        )
    }

    private fun updateState(block: (HtmlTestUiState) -> HtmlTestUiState) {
        _state.update(block)
        persistSession()
    }

    fun dismissProgressRestoredNotice() {
        _state.update { it.copy(progressRestoredNotice = false) }
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
        sessionStore.clear()
        updateState {
            it.copy(
                screen = TestScreen.Question,
                currentIndex = 0,
                answers = emptyMap(),
                orderedExercises = buildSessionOrder(canonical),
                submitMessage = null,
                progressRestoredNotice = false,
            )
        }
    }

    fun selectChoice(choiceId: String) {
        val s = _state.value
        val ex = s.orderedExercises.getOrNull(s.currentIndex) ?: return
        if (ex !is Exercise.MultipleChoice) return
        updateState { it.copy(answers = it.answers + (ex.id to choiceId)) }
    }

    fun setTypedAnswer(text: String) {
        val s = _state.value
        val ex = s.orderedExercises.getOrNull(s.currentIndex) ?: return
        if (ex is Exercise.MultipleChoice) return
        updateState { it.copy(answers = it.answers + (ex.id to text)) }
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
            updateState { it.copy(currentIndex = it.currentIndex + 1, progressRestoredNotice = false) }
        } else {
            updateState { it.copy(screen = TestScreen.Review, progressRestoredNotice = false) }
        }
    }

    fun back() {
        val s = _state.value
        if (s.screen != TestScreen.Question) return
        if (s.currentIndex > 0) {
            updateState { it.copy(currentIndex = it.currentIndex - 1, progressRestoredNotice = false) }
        }
    }

    fun editAnswers() {
        updateState {
            it.copy(
                screen = TestScreen.Question,
                currentIndex = 0,
                progressRestoredNotice = false,
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
                publishedExerciseIds = sessionExercises.sortedBy { it.id }.map { it.id },
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
                        sessionStore.clear()
                        _state.update {
                            it.copy(
                                isSubmitting = false,
                                screen = TestScreen.Done,
                                submitMessage = "Submitted. Reference: ${res.id ?: "ok"}",
                                progressRestoredNotice = false,
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
                            submitMessage = ApiFactory.messageForSubmitFailure(e),
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
        sessionStore.clear()
        _state.value = HtmlTestUiState()
        refreshQuiz()
    }
}
