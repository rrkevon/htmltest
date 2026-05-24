package com.htmlbasicstest.app

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.htmlbasicstest.app.data.Exercise

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE,
        )
        enableEdgeToEdge()
        setContent {
            val scheme = lightColorScheme()
            MaterialTheme(colorScheme = scheme) {
                Surface(modifier = Modifier.fillMaxSize()) {
                    HtmlTestApp()
                }
            }
        }
    }
}

@Composable
fun HtmlTestApp(vm: HtmlTestViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val isLoadingQuiz = state.quizLoadState == QuizLoadState.Loading
    val isSubmitting = state.isSubmitting
    val showLoadingOverlay = isLoadingQuiz || isSubmitting

    Box(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(20.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = "HTML basics",
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = "Questions load from your class server. No quiz is stored inside the app.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            when (state.screen) {
                TestScreen.Intro -> IntroContent(vm, state)
                TestScreen.Question -> QuestionContent(vm, state, state.orderedExercises)
                TestScreen.Review -> ReviewContent(vm, state, state.orderedExercises)
                TestScreen.Done -> DoneContent(vm, state)
            }
        }

        LoadingOverlay(
            visible = showLoadingOverlay,
            title = when {
                isSubmitting -> "Submitting your answers"
                else -> "Connecting to class server"
            },
            message = when {
                isSubmitting ->
                    "Sending your work to the server. Please keep the app open — this can take up to 2 minutes if the server was idle."
                else ->
                    "Loading the quiz. If the server has been idle, the first connection can take 1–2 minutes on free hosting."
            },
        )
    }
}

@Composable
private fun LoadingOverlay(
    visible: Boolean,
    title: String,
    message: String,
) {
    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(animationSpec = tween(250)),
        exit = fadeOut(animationSpec = tween(200)),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.5f)),
            contentAlignment = Alignment.Center,
        ) {
            val pulse = rememberInfiniteTransition(label = "loadingPulse")
            val scale by pulse.animateFloat(
                initialValue = 0.94f,
                targetValue = 1.06f,
                animationSpec = infiniteRepeatable(
                    animation = tween(900, easing = FastOutSlowInEasing),
                    repeatMode = RepeatMode.Reverse,
                ),
                label = "cardScale",
            )
            Card(
                modifier = Modifier
                    .padding(horizontal = 32.dp)
                    .scale(scale),
                shape = RoundedCornerShape(20.dp),
                elevation = CardDefaults.cardElevation(defaultElevation = 8.dp),
            ) {
                Column(
                    modifier = Modifier.padding(horizontal = 28.dp, vertical = 32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(52.dp),
                        strokeWidth = 4.dp,
                    )
                    Text(
                        text = title,
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                    )
                    Text(
                        text = message,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                }
            }
        }
    }
}

@Composable
private fun IntroContent(vm: HtmlTestViewModel, state: HtmlTestUiState) {
    when (state.quizLoadState) {
        QuizLoadState.Loading -> {
            // Full-screen LoadingOverlay handles feedback; keep layout stable underneath.
        }
        QuizLoadState.NoTest -> {
            Text(
                text = state.quizMessage?.takeIf { it.isNotBlank() } ?: "No test at this time.",
                style = MaterialTheme.typography.bodyLarge,
            )
            Spacer(Modifier.height(12.dp))
            OutlinedButton(onClick = { vm.refreshQuiz() }) { Text("Check again") }
        }
        QuizLoadState.Error -> {
            Text(
                text = state.quizMessage ?: "Could not load the quiz.",
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyLarge,
            )
            Spacer(Modifier.height(12.dp))
            OutlinedButton(onClick = { vm.refreshQuiz() }) { Text("Retry") }
        }
        QuizLoadState.Ready -> {
            OutlinedTextField(
                value = state.participantLabel,
                onValueChange = { vm.setParticipantLabel(it) },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                label = { Text("Name or ID (optional)") },
                placeholder = { Text("Shown on the server with your answers") },
            )
            state.quizMessage?.takeIf { it.isNotBlank() }?.let { note ->
                Spacer(Modifier.height(8.dp))
                Text(
                    text = note,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.height(8.dp))
            Button(onClick = { vm.startTest() }) {
                Text("Begin (${state.canonicalExercises.size} questions)")
            }
        }
    }
}

@Composable
private fun QuestionContent(
    vm: HtmlTestViewModel,
    state: HtmlTestUiState,
    exercises: List<Exercise>,
) {
    val ex = exercises[state.currentIndex]
    val progress = (state.currentIndex + 1).toFloat() / exercises.size

    LinearProgressIndicator(
        progress = { progress },
        modifier = Modifier.fillMaxWidth(),
    )
    Text(
        text = "Question ${state.currentIndex + 1} of ${exercises.size}",
        style = MaterialTheme.typography.labelLarge,
    )
    Text(text = ex.title, style = MaterialTheme.typography.titleLarge)
    Text(text = ex.prompt, style = MaterialTheme.typography.bodyLarge)

    when (ex) {
        is Exercise.MultipleChoice -> {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                ex.choices.forEach { c ->
                    val selected = state.answers[ex.id] == c.id
                    OutlinedButton(
                        onClick = { vm.selectChoice(c.id) },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            text = c.label,
                            fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                            fontFamily = FontFamily.Monospace,
                        )
                    }
                }
            }
        }
        is Exercise.ShortText -> {
            TypedAnswerField(
                value = state.answers[ex.id].orEmpty(),
                onChange = { vm.setTypedAnswer(it) },
                placeholder = ex.placeholder,
            )
        }
        is Exercise.FillBlank -> {
            CodeSnippetCard(ex.code)
            TypedAnswerField(
                value = state.answers[ex.id].orEmpty(),
                onChange = { vm.setTypedAnswer(it) },
                placeholder = ex.placeholder,
            )
        }
    }

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        OutlinedButton(
            onClick = { vm.back() },
            enabled = state.currentIndex > 0,
        ) { Text("Back") }

        val answer = state.answers[ex.id].orEmpty()
        val canContinue = when (ex) {
            is Exercise.MultipleChoice -> answer.isNotEmpty()
            is Exercise.ShortText, is Exercise.FillBlank -> answer.isNotBlank()
        }
        Button(
            onClick = { vm.next() },
            enabled = canContinue,
        ) { Text(if (state.currentIndex == exercises.lastIndex) "Review" else "Next") }
    }
}

@Composable
private fun TypedAnswerField(value: String, onChange: (String) -> Unit, placeholder: String) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
        textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace),
        placeholder = { Text(placeholder, fontFamily = FontFamily.Monospace) },
        // Avoid the keyboard auto-capitalizing tags like <p>.
        keyboardOptions = KeyboardOptions(
            capitalization = KeyboardCapitalization.None,
            autoCorrect = false,
        ),
    )
}

@Composable
private fun CodeSnippetCard(code: String) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(),
    ) {
        Text(
            text = code,
            fontFamily = FontFamily.Monospace,
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.padding(12.dp),
        )
    }
}

@Composable
private fun ReviewContent(
    vm: HtmlTestViewModel,
    state: HtmlTestUiState,
    exercises: List<Exercise>,
) {
    Text("Review", style = MaterialTheme.typography.titleLarge)
    state.submitMessage?.let { msg ->
        Text(
            text = msg,
            color = MaterialTheme.colorScheme.error,
            style = MaterialTheme.typography.bodyMedium,
        )
    }
    exercises.forEach { ex ->
        val raw = state.answers[ex.id].orEmpty()
        val display = when (ex) {
            is Exercise.MultipleChoice -> ex.choices.find { it.id == raw }?.label ?: "—"
            is Exercise.ShortText, is Exercise.FillBlank -> if (raw.isBlank()) "—" else raw
        }
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(),
        ) {
            Column(Modifier.padding(12.dp)) {
                Text(ex.title, fontWeight = FontWeight.SemiBold)
                Text(
                    text = "Your answer: $display",
                    style = MaterialTheme.typography.bodyMedium,
                    fontFamily = FontFamily.Monospace,
                )
            }
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        OutlinedButton(onClick = { vm.editAnswers() }) { Text("Edit answers") }
        Button(
            onClick = { vm.submit() },
            enabled = !state.isSubmitting,
        ) {
            Text("Submit to server")
        }
    }
}

@Composable
private fun DoneContent(vm: HtmlTestViewModel, state: HtmlTestUiState) {
    Text("Finished", style = MaterialTheme.typography.titleLarge)
    state.submitMessage?.let { Text(it) }
    Spacer(Modifier.height(8.dp))
    Button(onClick = { vm.resetToIntro() }) { Text("Start over") }
}
